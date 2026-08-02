// Sistema "Anuncios con Confirmación Obligatoria" (nuevo): para cuando un
// admin necesita estar SEGURO de que todos leyeron algo — el reglamento
// nuevo del consorcio, un cambio de horario, lo que sea — no alcanza con
// que el mensaje "aparezca", hace falta que cada miembro lo confirme
// explícitamente. El admin puede ver en cualquier momento quién ya
// confirmó y a quién todavía le falta, sin tener que preguntar uno por uno.
//
// Guardado en Message.metadata (Json que ya existía, mismo patrón que
// Cápsulas del Tiempo y Reenviado Muchas Veces): { requireAck: true,
// ackedBy: string[] }.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { io } from '../../index';

export const announcementsRouter = Router();
announcementsRouter.use(authMiddleware);

// Marca un mensaje YA EXISTENTE como anuncio con confirmación obligatoria — solo un admin del grupo.
announcementsRouter.post('/:messageId/require-ack', async (req: AuthRequest, res) => {
  const { messageId } = req.params;
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.isDeleted) return res.status(404).json({ error: 'Mensaje no encontrado' });

  const admin = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId: message.chatId } }
  });
  if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admins pueden pedir confirmación de lectura' });

  const metadata = { ...(message.metadata as any || {}), requireAck: true, ackedBy: [] as string[] };
  await prisma.message.update({ where: { id: messageId }, data: { metadata } });
  io.to(message.chatId).emit('announcement_created', { messageId, chatId: message.chatId });

  return res.json({ requireAck: true });
});

// Un miembro confirma que leyó el anuncio.
announcementsRouter.post('/:messageId/ack', async (req: AuthRequest, res) => {
  const { messageId } = req.params;
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.isDeleted) return res.status(404).json({ error: 'Mensaje no encontrado' });

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId: message.chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const metadata: any = message.metadata || {};
  if (!metadata.requireAck) return res.status(400).json({ error: 'Este mensaje no requiere confirmación' });

  const ackedBy: string[] = metadata.ackedBy || [];
  if (!ackedBy.includes(req.userId!)) ackedBy.push(req.userId!);
  await prisma.message.update({ where: { id: messageId }, data: { metadata: { ...metadata, ackedBy } } });

  io.to(message.chatId).emit('announcement_acked', { messageId, userId: req.userId });
  return res.json({ ackedBy });
});

// El admin ve quién falta confirmar (compara contra los miembros reales del grupo).
announcementsRouter.get('/:messageId/status', async (req: AuthRequest, res) => {
  const { messageId } = req.params;
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.isDeleted) return res.status(404).json({ error: 'Mensaje no encontrado' });

  const admin = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId: message.chatId } }
  });
  if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admins pueden ver el estado de confirmaciones' });

  const metadata: any = message.metadata || {};
  if (!metadata.requireAck) return res.status(400).json({ error: 'Este mensaje no requiere confirmación' });

  const allMembers = await prisma.chatUser.findMany({ where: { chatId: message.chatId } });
  const ackedBy: string[] = metadata.ackedBy || [];
  const pending = allMembers.map((m: any) => m.userId).filter((id: string) => !ackedBy.includes(id));

  return res.json({ acked: ackedBy, pending, total: allMembers.length });
});
