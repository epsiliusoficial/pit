// Sistema "Panel Admin": métricas reales de la plataforma (no inventadas).
// Protegido con una clave simple de admin (ADMIN_SECRET en .env) — suficiente
// para un panel interno, no reemplaza un sistema de roles completo.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { auditLog } from '../../core/audit/auditLog';
import { safeCompare } from '../../core/utils/safeCompare';
import { analyzeAccountRisk } from '../moderation/accountRisk';

export const adminRouter = Router();

function requireAdminSecret(req: any, res: any, next: any) {
  const secret = req.headers['x-admin-secret'];
  if (!secret || !process.env.ADMIN_SECRET || !safeCompare(String(secret), process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
}

adminRouter.use(requireAdminSecret);

adminRouter.get('/stats', async (_req, res) => {
  const [userCount, messageCount, chatCount, activeToday] = await Promise.all([
    prisma.user.count(),
    prisma.message.count(),
    prisma.chat.count(),
    prisma.user.count({ where: { lastSeen: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
  ]);

  return res.json({
    userCount,
    messageCount,
    chatCount,
    activeToday,
    timestamp: new Date().toISOString()
  });
});

adminRouter.get('/audit-log', async (req, res) => {
  const action = req.query.action as string | undefined;
  const logs = await prisma.auditLog.findMany({
    where: action ? { action } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  return res.json(logs);
});

adminRouter.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, phone: true, tier: true, isOnline: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return res.json(users);
});

// Sistema "Detector de Cuentas Falsas/Spam": calcula señales reales contra
// la base de datos (antigüedad, volumen, dispersión entre chats, reportes)
// y devuelve un puntaje de riesgo — NUNCA banea automático, es una lista
// priorizada para que un admin humano revise primero las más sospechosas.
adminRouter.get('/risky-accounts', async (_req, res) => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const candidates = await prisma.user.findMany({
    where: { tier: { not: 'BANNED' } },
    select: { id: true, name: true, avatarUrl: true, bio: true, isVerified: true, createdAt: true },
    take: 500,
    orderBy: { createdAt: 'desc' }
  });
  const candidateIds = candidates.map((u: any) => u.id);

  // Sistema optimizado con groupBy (no N+1): 3 consultas totales para
  // TODOS los candidatos, en vez de 2-3 consultas por cada uno — mismo
  // criterio que ya aplicamos antes en chatList.ts y contacts.ts.
  const [reports, totalMessageCounts, recentMessages] = await Promise.all([
    prisma.report.groupBy({ by: ['reportedId'], _count: { reportedId: true } }),
    prisma.message.groupBy({ by: ['senderId'], where: { senderId: { in: candidateIds } }, _count: { senderId: true } }),
    prisma.message.findMany({
      where: { senderId: { in: candidateIds }, createdAt: { gte: oneHourAgo } },
      select: { senderId: true, chatId: true }
    })
  ]);

  const reportCountByUser = new Map<string, number>(reports.map((r: any) => [r.reportedId, r._count.reportedId]));
  const totalMessagesByUser = new Map<string, number>(totalMessageCounts.map((m: any) => [m.senderId, m._count.senderId]));

  const distinctChatsByUser = new Map<string, Set<string>>();
  for (const m of recentMessages as any[]) {
    if (!distinctChatsByUser.has(m.senderId)) distinctChatsByUser.set(m.senderId, new Set());
    distinctChatsByUser.get(m.senderId)!.add(m.chatId);
  }

  const results = [];
  for (const user of candidates) {
    const accountAgeHours = Math.max((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60), 0.01);

    const report = analyzeAccountRisk({
      userId: user.id,
      accountAgeHours,
      messagesSentTotal: totalMessagesByUser.get(user.id) || 0,
      distinctChatsMessagedLastHour: distinctChatsByUser.get(user.id)?.size || 0,
      hasAvatar: !!user.avatarUrl,
      hasBio: !!user.bio,
      isVerified: user.isVerified,
      reportsAgainstUser: reportCountByUser.get(user.id) || 0
    });

    if (report.riskScore > 0) results.push({ ...report, name: user.name });
  }

  results.sort((a, b) => b.riskScore - a.riskScore);
  return res.json(results.slice(0, 50));
});

// Suspende una cuenta cambiando su tier a BANNED (se puede chequear en el middleware de auth).
adminRouter.post('/users/:id/ban', async (req, res) => {
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { tier: 'BANNED' } });
  await auditLog({ action: 'USER_BANNED', targetId: user.id, ip: req.ip });
  return res.json({ banned: true, user: { id: user.id, name: user.name } });
});
