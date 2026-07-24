// Sistema "Stickers": packs reales en base de datos, con contador de uso real
// (para poder mostrar "más usados" — no es un contador decorativo).
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { io } from '../../index';

export const stickerRouter = Router();
stickerRouter.use(authMiddleware);

stickerRouter.get('/packs', async (_req, res) => {
  const packs = await prisma.stickerPack.findMany({ include: { stickers: true } });
  return res.json(packs);
});

stickerRouter.get('/most-used', async (_req, res) => {
  const stickers = await prisma.sticker.findMany({
    orderBy: { usageCount: 'desc' },
    take: 20
  });
  return res.json(stickers);
});

// Enviar un sticker es un mensaje real (contentType STICKER), no un evento aparte,
// así hereda automáticamente historial, reacciones, reenvío, todo lo que ya existe.
stickerRouter.post('/send', async (req: AuthRequest, res) => {
  const { chatId, stickerId } = req.body;
  if (!chatId || !stickerId) return res.status(400).json({ error: 'chatId y stickerId requeridos' });

  const sticker = await prisma.sticker.findUnique({ where: { id: stickerId } });
  if (!sticker) return res.status(404).json({ error: 'Sticker no encontrado' });

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const message = await prisma.message.create({
    data: {
      chatId,
      senderId: req.userId!,
      content: sticker.emoji,
      contentType: 'STICKER',
      metadata: { stickerId: sticker.id, imageUrl: sticker.imageUrl }
    }
  });
  await prisma.sticker.update({ where: { id: stickerId }, data: { usageCount: { increment: 1 } } });

  io.to(chatId).emit('new_message', message);
  return res.json(message);
});
