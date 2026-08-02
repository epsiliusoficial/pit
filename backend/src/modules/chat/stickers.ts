// Sistema "Stickers": packs reales en base de datos, con contador de uso real
// (para poder mostrar "más usados" — no es un contador decorativo).
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { io } from '../../index';
import { encryptContent } from '../../core/crypto/messageEncryption';
import { sendPushNotification } from '../notifications/push';
import { registerActivity, BADGES } from '../social/achievements';
import { logger } from '../../core/utils/logger';

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

  // Bug real corregido: el contenido se guardaba en texto plano (`sticker.emoji`
  // tal cual), rompiendo la garantía de "todo mensaje está cifrado en reposo"
  // que cumple cada otro tipo de contenido — misma inconsistencia que ya se
  // corrigió una vez en el seed. Ahora usa encryptContent como cualquier mensaje.
  const message = await prisma.message.create({
    data: {
      chatId,
      senderId: req.userId!,
      content: encryptContent(sticker.emoji),
      contentType: 'STICKER',
      metadata: { stickerId: sticker.id, imageUrl: sticker.imageUrl }
    }
  });
  await prisma.sticker.update({ where: { id: stickerId }, data: { usageCount: { increment: 1 } } });

  const messageForClient = { ...message, content: sticker.emoji };
  io.to(chatId).emit('new_message', messageForClient);

  // Bug real corregido: mandar un sticker es mandar un mensaje real, pero
  // este endpoint nunca llamaba a sendPushNotification ni a registerActivity
  // — a diferencia de /chat/send. Resultado: a nadie le llegaba un push por
  // un sticker (aunque no tuvieras la app abierta), y mandar solo stickers
  // no contaba para la racha ni los logros. Mismo comportamiento que
  // /chat/send ahora.
  const otherMembers = await prisma.chatUser.findMany({ where: { chatId, NOT: { userId: req.userId! } } });
  const sender = await prisma.user.findUnique({ where: { id: req.userId! }, select: { name: true } });
  for (const m of otherMembers as any[]) {
    sendPushNotification(m.userId, sender?.name || 'Pit', `${sticker.emoji} Sticker`, req.userId!)
      .catch((e) => logger.error('Error enviando push de sticker', e));
  }
  registerActivity(req.userId!)
    .then((result) => {
      for (const code of result.unlocked) {
        io.to(`user:${req.userId}`).emit('achievement_unlocked', { code, label: BADGES[code]?.label });
        sendPushNotification(req.userId!, '¡Logro desbloqueado! 🏆', BADGES[code]?.label || code)
          .catch((e) => logger.error('Error enviando push de logro', e));
      }
    })
    .catch((e) => logger.error('Error registrando actividad', e));

  return res.json(messageForClient);
});
