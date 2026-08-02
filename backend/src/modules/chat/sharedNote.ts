// Sistema "Notas Compartidas de Grupo" (nuevo): un espacio de texto único
// por chat que cualquier miembro puede editar — para la lista de compras
// familiar, las reglas del grupo, el temario de la próxima reunión, lo que
// sea que el grupo quiera tener siempre a mano sin scrollear el historial.
// Piensa "una pizarra", no "un chat más".
//
// Guardado en Chat.groupConfig.sharedNote = { content, updatedBy, updatedAt }
// (mismo campo Json que ya usan Mensajes Fijados, Roles Personalizados y
// Solicitudes de Unión). Última edición gana — sin versionado, a propósito:
// es una pizarra compartida, no un documento con historial de cambios.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { io } from '../../index';

export const sharedNoteRouter = Router();
sharedNoteRouter.use(authMiddleware);

const MAX_LENGTH = 5000;

sharedNoteRouter.get('/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const member = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  const sharedNote = (chat?.groupConfig as any)?.sharedNote || { content: '', updatedBy: null, updatedAt: null };
  return res.json(sharedNote);
});

sharedNoteRouter.put('/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const { content } = req.body;

  if (typeof content !== 'string') return res.status(400).json({ error: 'content debe ser texto' });
  if (content.length > MAX_LENGTH) return res.status(400).json({ error: `content no puede superar los ${MAX_LENGTH} caracteres` });

  const member = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  const groupConfig = { ...(chat?.groupConfig as any || {}) };
  const sharedNote = { content, updatedBy: req.userId, updatedAt: new Date().toISOString() };
  groupConfig.sharedNote = sharedNote;

  await prisma.chat.update({ where: { id: chatId }, data: { groupConfig } });
  io.to(chatId).emit('shared_note_updated', sharedNote);
  return res.json(sharedNote);
});
