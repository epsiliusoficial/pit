// Sistema "Pit Wrapped" (nuevo, mismo espíritu que Spotify Wrapped): tus
// propias estadísticas reales de uso — cuántos mensajes mandaste, tu chat
// más activo, tu racha actual (reusa el sistema de Logros que ya existía),
// a qué hora del día escribís más. Todo calculado sobre datos reales, nada
// inventado ni aproximado.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const wrappedRouter = Router();
wrappedRouter.use(authMiddleware);

wrappedRouter.get('/', async (req: AuthRequest, res) => {
  const userId = req.userId!;

  const [totalMessages, byChat, streak, achievementsCount, allMyMessages] = await Promise.all([
    prisma.message.count({ where: { senderId: userId, isDeleted: false } }),
    prisma.message.groupBy({
      by: ['chatId'],
      where: { senderId: userId, isDeleted: false },
      _count: { chatId: true },
      orderBy: { _count: { chatId: 'desc' } },
      take: 1
    }),
    prisma.userStreak.findUnique({ where: { userId } }),
    prisma.achievement.count({ where: { userId } }),
    prisma.message.findMany({ where: { senderId: userId, isDeleted: false }, select: { createdAt: true } })
  ]);

  // Hora del día en la que más mensajes mandaste, calculado sobre datos reales.
  const hourCounts = new Array(24).fill(0);
  for (const m of allMyMessages) hourCounts[new Date(m.createdAt).getHours()]++;
  const mostActiveHour = hourCounts.indexOf(Math.max(...hourCounts));

  let topChat: { chatId: string; name: string | null; messageCount: number } | null = null;
  if (byChat.length > 0) {
    const chat = await prisma.chat.findUnique({ where: { id: byChat[0].chatId } });
    topChat = { chatId: byChat[0].chatId, name: chat?.name || null, messageCount: byChat[0]._count.chatId };
  }

  return res.json({
    totalMessages,
    topChat,
    currentStreak: streak?.currentStreak || 0,
    longestStreak: streak?.longestStreak || 0,
    achievementsUnlocked: achievementsCount,
    mostActiveHour: allMyMessages.length > 0 ? mostActiveHour : null
  });
});
