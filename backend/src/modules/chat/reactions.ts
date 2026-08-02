// Sistema "Reacciones": like WhatsApp/Telegram pero con toggle real (tocar de nuevo la quita).
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { io } from '../../index';

export const reactionRouter = Router();
reactionRouter.use(authMiddleware);

reactionRouter.post('/:messageId', async (req: AuthRequest, res) => {
  const { messageId } = req.params;
  const { emoji } = req.body;
  // Validación real: además del límite de tamaño, se exige que sea de
  // verdad un emoji/símbolo (rango Unicode de emojis, dingbats, etc.) y no
  // cualquier texto corto — antes un cliente distinto al oficial podía
  // mandar cualquier string de hasta 8 caracteres como "reacción", que el
  // frontend interpolaba sin escapar (ver renderReactions en index.html,
  // ya corregido del lado del cliente también).
  const EMOJI_REGEX = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f]+$/u;
  if (!emoji || typeof emoji !== 'string' || emoji.length > 8 || !EMOJI_REGEX.test(emoji)) {
    return res.status(400).json({ error: 'emoji inválido' });
  }

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) return res.status(404).json({ error: 'Mensaje no encontrado' });

  // Bug real corregido (mismo patrón que en encuestas/destacados/juegos):
  // no se verificaba que el usuario perteneciera al chat del mensaje —
  // cualquiera podía reaccionar a mensajes de chats ajenos e inyectar
  // eventos reaction_update a esos chats.
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId: message.chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const existing = await prisma.reaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId: req.userId!, emoji } }
  });

  let action: 'added' | 'removed';
  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } });
    action = 'removed';
  } else {
    await prisma.reaction.create({ data: { messageId, userId: req.userId!, emoji } });
    action = 'added';
  }

  const allReactions = await prisma.reaction.findMany({ where: { messageId } });
  io.to(message.chatId).emit('reaction_update', { messageId, action, emoji, userId: req.userId, reactions: allReactions });
  return res.json({ action, reactions: allReactions });
});
