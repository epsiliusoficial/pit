// Sistema "Logros y Rachas": calcula de verdad si el usuario mandó mensajes hoy
// y ayer para mantener la racha, y desbloquea insignias reales según hitos.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { calculateXp, calculateLevelProgress } from './levels';

export const achievementRouter = Router();
achievementRouter.use(authMiddleware);

export const BADGES: Record<string, { label: string; check: (streak: number, totalMessages: number) => boolean }> = {
  STREAK_3: { label: '🔥 3 días seguidos', check: (s) => s >= 3 },
  STREAK_7: { label: '🔥🔥 Una semana seguida', check: (s) => s >= 7 },
  STREAK_30: { label: '🏆 Un mes seguido', check: (s) => s >= 30 },
  CHATTY_100: { label: '💬 100 mensajes enviados', check: (_s, t) => t >= 100 },
  CHATTY_1000: { label: '💬💬 1000 mensajes enviados', check: (_s, t) => t >= 1000 }
};

// Se llama internamente (o desde un endpoint) cada vez que el usuario manda un mensaje.
export async function registerActivity(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let streak = await prisma.userStreak.findUnique({ where: { userId } });
  if (!streak) {
    streak = await prisma.userStreak.create({
      data: { userId, currentStreak: 1, longestStreak: 1, lastActiveDay: today }
    });
  } else {
    const lastDay = streak.lastActiveDay ? new Date(streak.lastActiveDay) : null;
    const diffDays = lastDay ? Math.floor((today.getTime() - lastDay.getTime()) / 86400000) : null;

    if (diffDays === 0) {
      // ya contó hoy, no hace nada
    } else if (diffDays === 1) {
      const newStreak = streak.currentStreak + 1;
      streak = await prisma.userStreak.update({
        where: { userId },
        data: { currentStreak: newStreak, longestStreak: Math.max(newStreak, streak.longestStreak), lastActiveDay: today }
      });
    } else {
      streak = await prisma.userStreak.update({
        where: { userId },
        data: { currentStreak: 1, lastActiveDay: today }
      });
    }
  }

  const totalMessages = await prisma.message.count({ where: { senderId: userId } });

  // Bug real corregido: antes se hacía upsert con `update: {}` para cada
  // badge que cumplía la condición, y CUALQUIER upsert exitoso (ya existiera
  // o no) se agregaba a `unlocked` — es decir, alguien con una racha de 30
  // días "desbloqueaba" STREAK_3/STREAK_7/STREAK_30 de nuevo en cada mensaje
  // que mandaba, para siempre. Hoy no se nota porque nada consume este
  // valor todavía, pero es exactamente el bug que aparecería el día que se
  // muestre un aviso de "¡Logro desbloqueado!" — se repetiría en cada
  // mensaje. Ahora se chequea existencia ANTES de crear, así que `unlocked`
  // solo contiene logros genuinamente nuevos en esta llamada.
  const unlocked: string[] = [];
  for (const [code, badge] of Object.entries(BADGES)) {
    if (!badge.check(streak.currentStreak, totalMessages)) continue;
    const already = await prisma.achievement.findUnique({ where: { userId_code: { userId, code } } });
    if (already) continue;
    const created = await prisma.achievement.create({ data: { userId, code } }).catch(() => null);
    if (created) unlocked.push(code);
  }
  return { streak: streak.currentStreak, unlocked };
}

achievementRouter.get('/me', async (req: AuthRequest, res) => {
  const streak = await prisma.userStreak.findUnique({ where: { userId: req.userId! } });
  const achievements = await prisma.achievement.findMany({ where: { userId: req.userId! } });
  const totalMessages = await prisma.message.count({ where: { senderId: req.userId! } });

  // Sistema "Niveles": el XP se deriva de datos que ya teníamos (mensajes,
  // racha más larga, logros) — no es un contador aparte que se pueda
  // desincronizar de la actividad real.
  const xp = calculateXp({
    messagesSent: totalMessages,
    longestStreak: streak?.longestStreak || 0,
    achievementsUnlocked: achievements.length
  });
  const levelProgress = calculateLevelProgress(xp);

  return res.json({
    currentStreak: streak?.currentStreak || 0,
    longestStreak: streak?.longestStreak || 0,
    achievements: achievements.map((a: any) => ({ code: a.code, label: BADGES[a.code]?.label, unlockedAt: a.unlockedAt })),
    level: levelProgress
  });
});
