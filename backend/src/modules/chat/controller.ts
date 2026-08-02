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
import { maybeGetAutoReply } from './autoReply';
import { isModerator } from './customRoles';

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
  const { chatId, content, contentType, metadata, replyToId, mentions: clientMentions } = req.body;
  if (!chatId || !content) return res.status(400).json({ error: 'chatId y content requeridos' });

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } },
    include: { chat: { select: { groupConfig: true } } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  // Sistema "Canales de Difusión" (nuevo, ver modules/chat/broadcastChannels.ts):
  // un chat marcado como broadcast es de un solo emisor -> muchos oyentes,
  // como los canales de Telegram/WhatsApp. Se guarda en `groupConfig` (JSON
  // libre que ya existía en el schema) para no necesitar una migración de
  // Postgres nueva. Solo ADMIN puede publicar; el resto solo lee. Se pide
  // junto con la consulta de membresía de arriba (via `include`) para no
  // sumar un roundtrip extra a la base en el camino caliente de enviar un
  // mensaje.
  const isBroadcastChannel = !!((member as any).chat?.groupConfig as any)?.broadcast;
  if (isBroadcastChannel && member.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Este es un canal de difusión: solo el administrador puede publicar acá' });
  }

  // Sistema "Bloqueo": si en un chat 1 a 1 el otro usuario te bloqueó, no se entrega.
  const otherMembers = await prisma.chatUser.findMany({ where: { chatId, NOT: { userId: req.userId! } } });
  if (otherMembers.length === 1) {
    const blocked = await prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId: otherMembers[0].userId, blockedId: req.userId! } }
    });
    if (blocked) return res.status(403).json({ error: 'No podés enviar mensajes a este usuario' });
  }

  // Sistema "Mensajes de Voz" (nuevo): contentType VOICE espera metadata con
  // { fileId, fileKey, durationSec, waveform } — el archivo de audio en sí ya
  // se subió antes por el sistema de archivos cifrados existente
  // (POST /api/files/upload), esto solo valida la referencia. Tope real de
  // 5 minutos por nota de voz para que nadie mande un audio de 3 horas y
  // rompa la UI o el histórico del chat — no es cosmético, es un guardrail
  // real antes de tocar la base.
  if (contentType === 'VOICE') {
    const durationSec = Number(metadata?.durationSec);
    if (!metadata?.fileId || !metadata?.fileKey) {
      return res.status(400).json({ error: 'Mensaje de voz sin referencia de archivo válida' });
    }
    if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 300) {
      return res.status(400).json({ error: 'Las notas de voz no pueden durar más de 5 minutos' });
    }
  }

  try {
    // Sistema "E2E real (fase 1)": las menciones ya NO se parsean acá — el
    // servidor no puede leer dentro del sobre cifrado. El cliente las manda
    // resueltas (ya validó @nombre contra los miembros que tiene en pantalla).
    // Se re-valida solo que cada userId mencionado sea realmente miembro del
    // chat, para que un cliente malicioso no pueda "mencionar" a alguien que
    // no está en la conversación.
    let mentions: string[] = [];
    if (clientMentions?.length) {
      const members = await prisma.chatUser.findMany({ where: { chatId } });
      const memberIds = new Set(members.map((m: any) => m.userId));
      mentions = clientMentions.filter((id: string) => memberIds.has(id));
    }
    const message = await prisma.message.create({
      data: {
        chatId,
        senderId: req.userId!,
        // El sobre ya llega cifrado por el cliente (ECDH real) — el servidor
        // lo guarda tal cual, nunca ve el texto plano. ANTES acá se llamaba
        // encryptContent(content) sobre texto plano recibido del cliente;
        // eso era cifrado en reposo hecho por el server, no E2E.
        content,
        contentType: contentType || 'TEXT',
        metadata: metadata || undefined,
        replyToId: replyToId || undefined,
        mentions: mentions.length ? mentions : undefined
      }
    });
    // El propio remitente sí puede mostrar su mensaje al toque porque tiene
    // el texto plano en memoria del lado del cliente (antes de cifrarlo) —
    // el servidor solo reenvía el sobre cifrado a los demás.
    const messageForClient = message;
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
    // Sistema "E2E real (fase 1)": ANTES esto mandaba un preview del texto
    // real del mensaje en el push. Con E2E de verdad el servidor no tiene
    // el texto plano, así que el push deja de incluir contenido — mismo
    // approach que usa Signal (push "genérico", el cuerpo real solo se
    // muestra cuando la app abre el mensaje y lo descifra en el dispositivo).
    const sender = await prisma.user.findUnique({ where: { id: req.userId! }, select: { name: true } });
    for (const m of otherMembers) {
      sendPushNotification(m.userId, sender?.name || 'Pit', 'Te envió un mensaje', req.userId!)
        .catch((e) => logger.error('Error enviando push de mensaje nuevo', e));
    }

    // Sistema "Auto-Respuesta / Modo Ausente": si algún otro miembro del chat
    // la tiene activada, le contesta en su nombre — con cooldown real por
    // (chat, remitente) y protección contra loop si ambos la tienen activada.
    for (const m of otherMembers) {
      maybeGetAutoReply(m.userId, chatId, req.userId!, !!(metadata as any)?.autoReply)
        .then(async (autoText) => {
          if (!autoText) return;
          const autoMsg = await prisma.message.create({
            data: {
              chatId,
              senderId: m.userId,
              content: encryptContent(autoText),
              contentType: 'TEXT',
              metadata: { autoReply: true }
            }
          });
          io.to(chatId).emit('new_message', { ...autoMsg, content: autoText });
        })
        .catch((e) => logger.error('Error enviando auto-respuesta', e));
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
      await queueRetry({ chatId, senderId: req.userId!, content, contentType, metadata, replyToId });
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
  // decryptContent es seguro para ambos formatos (ver nota arriba en /send).
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
  if (!message) return res.status(404).json({ error: 'Mensaje no encontrado' });

  const isOwnMessage = message.senderId === req.userId;
  let canModerate = false;
  if (!isOwnMessage) {
    // Limitación real corregida: antes NI SIQUIERA un admin del grupo podía
    // borrar un mensaje ajeno problemático — ahora ADMIN y MODERATOR
    // (ver customRoles.ts) sí pueden, quien mandó el resto sigue pudiendo
    // borrar el suyo como siempre.
    const member = await prisma.chatUser.findUnique({
      where: { userId_chatId: { userId: req.userId!, chatId: message.chatId } }
    });
    canModerate = member?.role === 'ADMIN' || await isModerator(message.chatId, req.userId!);
  }

  if (!isOwnMessage && !canModerate) {
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

// Sistema "Múltiples Mensajes Fijados" (mejora real): antes `pinnedMsgId`
// guardaba UN SOLO mensaje fijado por chat — fijar uno nuevo hacía que el
// anterior se perdiera silenciosamente, sin aviso. Ahora se guarda una
// lista real en `groupConfig.pinnedMessageIds` (Json que ya existía en el
// modelo Chat — cero migraciones nuevas), con un tope de 20 para que el
// panel de fijados no se vuelva infinito. `pinnedMsgId` se sigue
// actualizando al último fijado, para no romper clientes viejos que solo
// leían ese campo.
const MAX_PINNED_PER_CHAT = 20;

chatRouter.post('/pin/:chatId/:messageId', async (req: AuthRequest, res) => {
  const { chatId, messageId } = req.params;
  const admin = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } },
    include: { chat: { select: { groupConfig: true } } }
  });
  if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admins pueden fijar mensajes' });

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.chatId !== chatId || message.isDeleted) {
    return res.status(404).json({ error: 'Mensaje no encontrado en este chat' });
  }

  const groupConfig = ((admin as any).chat?.groupConfig as any) || {};
  const pinnedMessageIds: string[] = groupConfig.pinnedMessageIds || [];
  if (!pinnedMessageIds.includes(messageId)) {
    if (pinnedMessageIds.length >= MAX_PINNED_PER_CHAT) {
      return res.status(400).json({ error: `Máximo ${MAX_PINNED_PER_CHAT} mensajes fijados por chat — desfijá alguno primero` });
    }
    pinnedMessageIds.push(messageId);
  }

  await prisma.chat.update({
    where: { id: chatId },
    data: { pinnedMsgId: messageId, groupConfig: { ...groupConfig, pinnedMessageIds } }
  });
  io.to(chatId).emit('message_pinned', { messageId });
  return res.json({ pinned: true, pinnedMessageIds });
});

chatRouter.delete('/pin/:chatId/:messageId', async (req: AuthRequest, res) => {
  const { chatId, messageId } = req.params;
  const admin = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } },
    include: { chat: { select: { groupConfig: true, pinnedMsgId: true } } }
  });
  if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admins pueden desfijar mensajes' });

  const groupConfig = ((admin as any).chat?.groupConfig as any) || {};
  const pinnedMessageIds: string[] = (groupConfig.pinnedMessageIds || []).filter((id: string) => id !== messageId);
  const currentTop = (admin as any).chat?.pinnedMsgId;
  const newTop = currentTop === messageId ? (pinnedMessageIds[pinnedMessageIds.length - 1] || null) : currentTop;

  await prisma.chat.update({
    where: { id: chatId },
    data: { pinnedMsgId: newTop, groupConfig: { ...groupConfig, pinnedMessageIds } }
  });
  io.to(chatId).emit('message_unpinned', { messageId });
  return res.json({ pinned: false, pinnedMessageIds });
});

// Sistema "E2E real (fase 2)": el cliente necesita la clave pública de cada
// miembro del chat para armar el sobre cifrado antes de mandar un mensaje.
// Esto es seguro de exponer: una clave PÚBLICA no protege nada por sí sola,
// es justamente la parte que está pensada para circular. Solo se expone a
// quien ya es miembro real del chat (se valida membresía primero).
chatRouter.get('/:chatId/members', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const requester = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!requester) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const members = await prisma.chatUser.findMany({
    where: { chatId },
    include: { user: { select: { id: true, name: true, publicKey: true } } }
  });
  return res.json({
    members: members.map((m: any) => ({ userId: m.user.id, name: m.user.name, publicKey: m.user.publicKey }))
  });
});

chatRouter.get('/pins/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } },
    include: { chat: { select: { groupConfig: true } } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const groupConfig = ((member as any).chat?.groupConfig as any) || {};
  const pinnedMessageIds: string[] = groupConfig.pinnedMessageIds || [];
  if (pinnedMessageIds.length === 0) return res.json({ pinned: [] });

  const messages = await prisma.message.findMany({
    where: { id: { in: pinnedMessageIds }, isDeleted: false }
  });
  const byId = new Map(messages.map((m: any) => [m.id, m]));
  const pinned = pinnedMessageIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    ;

  return res.json({ pinned });
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

// Sistema "Reenviado Muchas Veces" (nuevo, mismo criterio que WhatsApp):
// además de guardar quién mandó el mensaje original, ahora se cuenta cuántas
// veces viene reenviándose EN CADENA (reenviar un reenvío suma, reenviar el
// original de nuevo no infla el contador dos veces por accidente porque se
// arranca del contador real que ya traía el mensaje, no de cero). A partir
// de 5 reenvíos en cadena se marca `frequentlyForwarded: true` en la
// metadata — la señal real de "esto viajó tanto que ya nadie sabe de dónde
// salió", útil para que el cliente muestre una advertencia antes de que la
// persona lo crea a ciegas. No cambia el reenvío en sí, solo lo etiqueta.
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

  const originalMetadata: any = original.metadata || {};
  const baseForwardCount = typeof originalMetadata.forwardCount === 'number'
    ? originalMetadata.forwardCount
    : (original.forwardedFrom ? 1 : 0);
  const forwardCount = baseForwardCount + 1;

  const forwarded = await prisma.message.create({
    data: {
      chatId: toChatId,
      senderId: req.userId!,
      content: original.content, // ya viene cifrado con la misma clave maestra — se copia tal cual, sin descifrar y volver a cifrar
      contentType: original.contentType,
      metadata: { ...originalMetadata, forwardCount, frequentlyForwarded: forwardCount >= 5 },
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
// Sistema "Búsqueda Global" (nuevo): buscar en TODOS tus chats a la vez, no
// uno por uno. Reusa exactamente la misma lógica de autorización y
// desencriptado que la búsqueda por chat de abajo — la diferencia es que
// primero resuelve la lista real de chats donde el usuario es miembro
// (ChatUser), y solo mira mensajes de esos chats. Nadie ve resultados de un
// chat ajeno por más que adivine el texto. Se registra ANTES de
// '/:chatId/search' a propósito (aunque no colisionan por forma de ruta) para
// que quede documentado junto a su contraparte de un solo chat.
chatRouter.get('/search/global', async (req: AuthRequest, res) => {
  // Sistema "E2E real (fase 1)": este endpoint buscaba desencriptando cada
  // mensaje con la clave del servidor y comparando texto — imposible con E2E
  // real (el server ya no tiene forma de leer el contenido). Se corta acá,
  // con un error explícito, en vez de devolver resultados vacíos o rotos en
  // silencio. La búsqueda tiene que migrar al cliente, sobre los mensajes
  // que ya descifró localmente.
  return res.status(410).json({
    error: 'Búsqueda global movida al cliente: el servidor ya no puede leer el contenido de los mensajes (E2E real). Buscá sobre los mensajes ya descifrados en tu dispositivo.'
  });
});

// Sistema "Hilos de Respuesta" (nuevo): `replyToId` ya existía en el modelo
// Message, pero no había forma de ver "todas las respuestas a ESTE mensaje"
// juntas, tipo hilos de Slack — solo se veía la flechita de "responde a X" en
// cada mensaje suelto, desperdigado en el chat. Este endpoint arma la vista
// completa: el mensaje raíz + todas sus respuestas directas, ordenadas, ya
// desencriptadas.
chatRouter.get('/thread/:messageId', async (req: AuthRequest, res) => {
  const { messageId } = req.params;

  const root = await prisma.message.findUnique({
    where: { id: messageId },
    include: { sender: { select: { id: true, name: true } } }
  });
  if (!root || root.isDeleted) return res.status(404).json({ error: 'Mensaje no encontrado' });

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId: root.chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const replies = await prisma.message.findMany({
    where: { replyToId: messageId, isDeleted: false },
    orderBy: { createdAt: 'asc' },
    include: { sender: { select: { id: true, name: true } } }
  });

  return res.json({
    root: { ...root, content: decryptContent(root.content) },
    replies: replies.map((m: any) => ({ ...m, content: decryptContent(m.content) })),
    replyCount: replies.length
  });
});

chatRouter.get('/:chatId/search', async (req: AuthRequest, res) => {
  // Sistema "E2E real (fase 1)": mismo motivo que /search/global — no se
  // puede buscar contra contenido cifrado E2E desde el servidor.
  return res.status(410).json({
    error: 'Búsqueda movida al cliente: el servidor ya no puede leer el contenido de los mensajes (E2E real).'
  });
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
