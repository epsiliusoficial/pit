import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { io } from '../../index';
import { queueRetry } from './tornado';
import { rateLimiter } from './rateLimiter';
import { registerActivity, BADGES } from '../social/achievements';
import { logger } from '../../core/utils/logger';
import { validateBody, sendMessageSchema, createChatSchema } from '../../core/validation/schemas';
import { encryptContent, decryptContent } from '../../core/crypto/messageEncryption';
import { sendPushNotification } from '../notifications/push';

export const chatRouter = Router();
chatRouter.use(authMiddleware);

// Sistema "Menciones": detecta @nombre en el texto y devuelve los userIds mencionados
// (se resuelve contra los miembros reales del chat, no es un parseo cosmético).
async function extractMentions(chatId: string, content: string): Promise<string[]> {
  const handles = Array.from(content.matchAll(/@(\w+)/g)).map((m) => m[1].toLowerCase());
  if (handles.length === 0) return [];
  const members = await prisma.chatUser.findMany({ where: { chatId }, include: { user: true } });
  return members
    .filter((m: any) => handles.includes(m.user.name.toLowerCase()))
    .map((m: any) => m.userId);
}

// Enviar mensaje (fallback REST del sistema Tornado si el socket falla en el cliente)
chatRouter.post('/send', rateLimiter, validateBody(sendMessageSchema), async (req: AuthRequest, res) => {
  const { chatId, content, contentType, metadata, replyToId } = req.body;
  if (!chatId || !content) return res.status(400).json({ error: 'chatId y content requeridos' });

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  // Sistema "Bloqueo": si en un chat 1 a 1 el otro usuario te bloqueó, no se entrega.
  const otherMembers = await prisma.chatUser.findMany({ where: { chatId, NOT: { userId: req.userId! } } });
  if (otherMembers.length === 1) {
    const blocked = await prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId: otherMembers[0].userId, blockedId: req.userId! } }
    });
    if (blocked) return res.status(403).json({ error: 'No podés enviar mensajes a este usuario' });
  }

  try {
    const mentions = await extractMentions(chatId, content); // se parsean menciones ANTES de cifrar
    const message = await prisma.message.create({
      data: {
        chatId,
        senderId: req.userId!,
        content: encryptContent(content), // Sistema "Cifrado en reposo": nunca se guarda texto plano
        contentType: contentType || 'TEXT',
        metadata: metadata || undefined,
        replyToId: replyToId || undefined,
        mentions: mentions.length ? mentions : undefined
      }
    });
    // Se devuelve/emite con el texto plano original (ya lo teníamos en memoria,
    // no hace falta descifrar de nuevo lo que acabamos de cifrar).
    const messageForClient = { ...message, content };
    io.to(chatId).emit('new_message', messageForClient);
    if (mentions.length) io.to(chatId).emit('mentioned', { messageId: message.id, mentions });
    registerActivity(req.userId!)
      .then((result) => {
        // Sistema de Logros completado: antes se calculaba quién desbloqueó
        // qué, pero el resultado se descartaba — un logro real (racha de 7
        // días, 100 mensajes, etc.) no le avisaba nada al usuario. Ahora se
        // notifica en vivo (su sala personal) y por push apenas se
        // desbloquea algo genuinamente nuevo.
        for (const code of result.unlocked) {
          io.to(`user:${req.userId}`).emit('achievement_unlocked', { code, label: BADGES[code]?.label });
          sendPushNotification(req.userId!, '¡Logro desbloqueado! 🏆', BADGES[code]?.label || code)
            .catch((e) => logger.error('Error enviando push de logro', e));
        }
      })
      .catch((e) => logger.error('Error registrando actividad', e));

    // Bug real corregido: la entrega en vivo por socket.io funcionaba, pero
    // nada avisaba a quien NO tiene la app abierta en ese momento — que es
    // justo para lo que existen las notificaciones push. sendPushNotification
    // ya existía y funcionaba (VAPID real), pero nunca se llamaba acá; solo
    // se usaba para el recordatorio de mensajes pospuestos. Se dispara para
    // cada otro miembro del chat, sin bloquear la respuesta al que envía, y
    // ya respeta Modo Concentración del receptor (shouldNotify adentro de
    // sendPushNotification).
    const sender = await prisma.user.findUnique({ where: { id: req.userId! }, select: { name: true } });
    const preview = content.length > 100 ? content.slice(0, 100) + '…' : content;
    for (const m of otherMembers) {
      sendPushNotification(m.userId, sender?.name || 'Pit', preview, req.userId!)
        .catch((e) => logger.error('Error enviando push de mensaje nuevo', e));
    }

    return res.json(messageForClient);
  } catch (err) {
    // Sistema Tornado: si falla la escritura, se encola para reintento (ya cifrado).
    //
    // Bug real corregido: si el ENCOLADO también fallaba (ej: Redis caído al
    // mismo tiempo que Postgres — el peor caso, pero pasa), esto tiraba una
    // promesa rechazada sin capturar. Express 4 no atrapa rechazos de
    // handlers async solo, así que el cliente se quedaba esperando una
    // respuesta que nunca llegaba — nada de 500, nada de 202, silencio total
    // hasta el timeout. Exactamente lo contrario de lo que "entrega
    // garantizada" promete. Ahora un fallo total del encolado devuelve un
    // 503 claro en vez de colgar la request.
    try {
      await queueRetry({ chatId, senderId: req.userId!, content: encryptContent(content), contentType, metadata, replyToId });
      return res.status(202).json({ queued: true });
    } catch (queueErr) {
      logger.error('Fallo total: ni la escritura directa ni el encolado de reintento funcionaron', queueErr);
      return res.status(503).json({ error: 'No se pudo enviar el mensaje. Reintentá en unos segundos.' });
    }
  }
});

chatRouter.get('/:chatId/history', async (req: AuthRequest, res) => {
  const { chatId } = req.params;

  // Bug real corregido: antes `limit` no tenía tope máximo — alguien podía
  // pedir `?limit=999999999` y forzar traer el historial completo del chat
  // en una sola consulta (problema de rendimiento/DoS real, no solo teórico).
  const requestedLimit = Number(req.query.limit) || 50;
  const limit = Math.min(Math.max(requestedLimit, 1), 100);

  // Sistema "Paginación con cursor": antes solo se podían ver los últimos N
  // mensajes, sin forma de "cargar más" hacia atrás en el historial. Ahora
  // se puede pasar ?before=<messageId> para traer la página anterior a ese
  // mensaje — el patrón estándar de paginación para scroll infinito.
  const beforeId = req.query.before as string | undefined;

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  let cursorClause = {};
  if (beforeId) {
    const cursorMessage = await prisma.message.findUnique({ where: { id: beforeId } });
    if (cursorMessage) {
      cursorClause = { createdAt: { lt: cursorMessage.createdAt } };
    }
  }

  const messages = await prisma.message.findMany({
    where: { chatId, isDeleted: false, ...cursorClause },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  // Sistema "Cifrado en reposo": se descifra acá, justo antes de responder al
  // cliente — nunca antes, nunca se persiste el texto plano en ningún lado.
  const decrypted = messages.map((m: any) => ({ ...m, content: decryptContent(m.content) }));

  return res.json({
    messages: decrypted.reverse(),
    hasMore: messages.length === limit,
    oldestId: messages[0]?.id || null // se usa como `before` en la siguiente página
  });
});

chatRouter.delete('/message/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message || message.senderId !== req.userId) {
    return res.status(403).json({ error: 'No podés borrar este mensaje' });
  }
  await prisma.message.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  io.to(message.chatId).emit('message_deleted', { id });
  return res.json({ deleted: true });
});

// Sistema "Papelera": los mensajes borrados quedan recuperables 30 días.
chatRouter.get('/trash/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const trashed = await prisma.message.findMany({
    where: { chatId, isDeleted: true, senderId: req.userId!, deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' }
  });
  return res.json(trashed.map((m: any) => ({ ...m, content: decryptContent(m.content) })));
});

chatRouter.post('/trash/:id/restore', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message || message.senderId !== req.userId) {
    return res.status(403).json({ error: 'No podés restaurar este mensaje' });
  }
  if (!message.deletedAt) return res.status(400).json({ error: 'Este mensaje no está en la papelera' });

  const daysSinceDeleted = (Date.now() - message.deletedAt.getTime()) / 86400000;
  if (daysSinceDeleted > 30) return res.status(400).json({ error: 'La papelera expira a los 30 días' });

  const restored = await prisma.message.update({
    where: { id },
    data: { isDeleted: false, deletedAt: null }
  });
  const restoredForClient = { ...restored, content: decryptContent(restored.content) };
  io.to(message.chatId).emit('new_message', restoredForClient);
  return res.json(restoredForClient);
});

chatRouter.post('/pin/:chatId/:messageId', async (req: AuthRequest, res) => {
  const { chatId, messageId } = req.params;
  const admin = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admins pueden fijar mensajes' });
  await prisma.chat.update({ where: { id: chatId }, data: { pinnedMsgId: messageId } });
  io.to(chatId).emit('message_pinned', { messageId });
  return res.json({ pinned: true });
});

// Sistema "Editar mensaje": edición real con historial marcado (isEdited)
chatRouter.put('/message/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content requerido' });

  const message = await prisma.message.findUnique({ where: { id } });
  if (!message || message.senderId !== req.userId) {
    return res.status(403).json({ error: 'No podés editar este mensaje' });
  }
  const updated = await prisma.message.update({
    where: { id },
    data: { content: encryptContent(content), isEdited: true }
  });
  const updatedForClient = { ...updated, content }; // ya tenemos el texto plano, no hace falta descifrar
  io.to(message.chatId).emit('message_edited', updatedForClient);
  return res.json(updatedForClient);
});

// Sistema "Confirmación de lectura": marca el mensaje como leído por el usuario actual
chatRouter.post('/read/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return res.status(404).json({ error: 'No encontrado' });

  const readBy: string[] = Array.isArray(message.readBy) ? (message.readBy as string[]) : [];
  if (!readBy.includes(req.userId!)) readBy.push(req.userId!);

  await prisma.message.update({ where: { id }, data: { readBy } });
  io.to(message.chatId).emit('message_read', { messageId: id, readBy });

  // Sistema "Fantasma Total": si el emisor lo activó para este chat, el mensaje
  // se borra apenas TODOS los demás miembros lo leyeron (real, no cosmético).
  const senderPrefs = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: message.senderId, chatId: message.chatId } }
  });
  if (senderPrefs?.autoDeleteAfterRead) {
    const allMembers = await prisma.chatUser.findMany({ where: { chatId: message.chatId } });
    const othersIds = allMembers.map((m: any) => m.userId).filter((uid: string) => uid !== message.senderId);
    const allRead = othersIds.every((uid: string) => readBy.includes(uid));
    if (allRead) {
      await prisma.message.update({ where: { id }, data: { isDeleted: true } });
      io.to(message.chatId).emit('message_deleted', { id });
    }
  }

  return res.json({ readBy });
});

// Sistema "Reenviar mensaje": copia el contenido a otro chat, guardando el origen
chatRouter.post('/forward/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { toChatId } = req.body;
  if (!toChatId) return res.status(400).json({ error: 'toChatId requerido' });

  const original = await prisma.message.findUnique({ where: { id } });
  if (!original) return res.status(404).json({ error: 'Mensaje original no encontrado' });

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId: toChatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a ese chat' });

  const forwarded = await prisma.message.create({
    data: {
      chatId: toChatId,
      senderId: req.userId!,
      content: original.content, // ya viene cifrado con la misma clave maestra — se copia tal cual, sin descifrar y volver a cifrar
      contentType: original.contentType,
      metadata: original.metadata as any,
      forwardedFrom: original.senderId
    }
  });
  const forwardedForClient = { ...forwarded, content: decryptContent(forwarded.content) };
  io.to(toChatId).emit('new_message', forwardedForClient);
  return res.json(forwardedForClient);
});

// Sistema "Mensajes efímeros": se autodestruyen pasado un tiempo (real, con cron de barrido)
chatRouter.post('/ephemeral', async (req: AuthRequest, res) => {
  const { chatId, content, ttlSeconds } = req.body;
  if (!chatId || !content || !ttlSeconds) {
    return res.status(400).json({ error: 'chatId, content y ttlSeconds requeridos' });
  }
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const message = await prisma.message.create({
    data: {
      chatId,
      senderId: req.userId!,
      content: encryptContent(content),
      contentType: 'TEXT',
      isEphemeral: true,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000)
    }
  });
  const messageForClient = { ...message, content };
  io.to(chatId).emit('new_message', messageForClient);
  return res.json(messageForClient);
});

// Sistema "Búsqueda de mensajes": con el contenido cifrado en reposo, ya NO
// se puede filtrar en SQL con `content: {contains}` (el texto en disco es
// ciphertext ilegible). Se trae una ventana acotada de mensajes recientes,
// se descifran en memoria, y se filtra ahí — el costo es traer más filas de
// las que finalmente importan, pero es el precio real y consciente de tener
// el contenido cifrado en vez de en texto plano.
chatRouter.get('/:chatId/search', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const q = String(req.query.q || '').toLowerCase();
  if (!q) return res.status(400).json({ error: 'query ?q= requerido' });

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const SEARCH_WINDOW = 1000; // ventana acotada de mensajes recientes a inspeccionar
  const candidates = await prisma.message.findMany({
    where: { chatId, isDeleted: false },
    orderBy: { createdAt: 'desc' },
    take: SEARCH_WINDOW
  });

  const results = [];
  for (const m of candidates as any[]) {
    const plain = decryptContent(m.content);
    if (plain.toLowerCase().includes(q)) {
      results.push({ ...m, content: plain });
      if (results.length >= 50) break;
    }
  }
  return res.json(results);
});
chatRouter.post('/create', validateBody(createChatSchema), async (req: AuthRequest, res) => {
  const { userIds, isGroup, name } = req.body;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds requerido' });
  }
  const allUserIds = Array.from(new Set([req.userId!, ...userIds]));
  const chat = await prisma.chat.create({
    data: {
      isGroup: !!isGroup,
      name: name || null,
      users: {
        create: allUserIds.map((id: string) => ({
          userId: id,
          role: id === req.userId ? 'ADMIN' : 'MEMBER'
        }))
      }
    },
    include: { users: true }
  });
  return res.json(chat);
});
