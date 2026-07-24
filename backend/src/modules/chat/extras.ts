import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { io } from '../../index';
import { encryptContent, decryptContent } from '../../core/crypto/messageEncryption';

export const extrasRouter = Router();
extrasRouter.use(authMiddleware);

// Sistema "Destacar mensaje": cada usuario tiene su propia lista de favoritos sobre un mensaje.
extrasRouter.post('/star/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return res.status(404).json({ error: 'No encontrado' });

  // Bug real corregido: no se verificaba que el usuario perteneciera al chat
  // del mensaje — cualquiera podía destacar mensajes de chats ajenos.
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId: message.chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const starred: string[] = Array.isArray(message.isStarred) ? (message.isStarred as string[]) : [];
  const idx = starred.indexOf(req.userId!);
  if (idx >= 0) starred.splice(idx, 1); else starred.push(req.userId!);

  await prisma.message.update({ where: { id }, data: { isStarred: starred } });
  return res.json({ starred: starred.includes(req.userId!) });
});

extrasRouter.get('/starred/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;

  // Bug real corregido (fuga de información seria): sin este chequeo,
  // combinado con el fix de arriba, un usuario podía leer el CONTENIDO de
  // mensajes de chats a los que no pertenece, si conseguía el ID de un
  // mensaje ajeno por cualquier otro medio (ej: eventos de socket de otro
  // chat, IDs filtrados, etc.) — esto cierra esa vía por completo.
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const messages = await prisma.message.findMany({ where: { chatId, isDeleted: false } });
  const mine = messages.filter((m: any) => Array.isArray(m.isStarred) && (m.isStarred as string[]).includes(req.userId!));
  return res.json(mine.map((m: any) => ({ ...m, content: decryptContent(m.content) })));
});

// Sistema "Mensajes programados": se guardan y el worker (scheduledWorker.ts) los envía a horario.
extrasRouter.post('/schedule', async (req: AuthRequest, res) => {
  const { chatId, content, sendAt } = req.body;
  if (!chatId || !content || !sendAt) return res.status(400).json({ error: 'chatId, content y sendAt requeridos' });

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  // Se cierra acá el último hueco de texto plano: antes ScheduledMessage.content
  // se guardaba sin cifrar hasta que llegaba la hora de envío. Ahora se cifra
  // desde el momento en que se programa, igual que cualquier Message real.
  const scheduled = await prisma.scheduledMessage.create({
    data: { chatId, senderId: req.userId!, content: encryptContent(content), sendAt: new Date(sendAt) }
  });
  return res.json({ ...scheduled, content }); // se devuelve el texto plano ya conocido, sin descifrar de nuevo
});

extrasRouter.get('/scheduled/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const items = await prisma.scheduledMessage.findMany({
    where: { chatId, senderId: req.userId!, sent: false }
  });
  return res.json(items.map((i: any) => ({ ...i, content: decryptContent(i.content) })));
});

extrasRouter.delete('/scheduled/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const item = await prisma.scheduledMessage.findUnique({ where: { id } });
  if (!item || item.senderId !== req.userId) return res.status(403).json({ error: 'No autorizado' });
  await prisma.scheduledMessage.delete({ where: { id } });
  return res.json({ deleted: true });
});

// Sistema "Broadcast": manda el mismo mensaje a varios chats de una sola vez (listas de difusión).
extrasRouter.post('/broadcast', async (req: AuthRequest, res) => {
  const { chatIds, content } = req.body;
  if (!Array.isArray(chatIds) || chatIds.length === 0 || !content) {
    return res.status(400).json({ error: 'chatIds y content requeridos' });
  }
  const created = [];
  for (const chatId of chatIds) {
    const member = await prisma.chatUser.findUnique({
      where: { userId_chatId: { userId: req.userId!, chatId } }
    });
    if (!member) continue; // se salta silenciosamente los chats a los que no pertenece
    const msg = await prisma.message.create({
      data: { chatId, senderId: req.userId!, content: encryptContent(content), contentType: 'TEXT' }
    });
    const msgForClient = { ...msg, content };
    io.to(chatId).emit('new_message', msgForClient);
    created.push(msgForClient);
  }
  return res.json({ sentTo: created.length, messages: created });
});

// Sistema "Exportar chat": descarga el historial completo como JSON (portabilidad real de datos).
extrasRouter.get('/export/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const messages = await prisma.message.findMany({
    where: { chatId, isDeleted: false },
    orderBy: { createdAt: 'asc' }
  });
  const decrypted = messages.map((m: any) => ({ ...m, content: decryptContent(m.content) }));
  res.setHeader('Content-Disposition', `attachment; filename="pit-chat-${chatId}.json"`);
  res.setHeader('Content-Type', 'application/json');
  return res.send(JSON.stringify(decrypted, null, 2));
});
