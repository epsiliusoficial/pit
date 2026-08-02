// Sistema "Modo Concentración": silencia notificaciones de todos menos de tu
// lista de favoritos, en una ventana horaria programada. Real: cualquier envío
// de push (push.ts) chequea esto antes de notificar.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const focusRouter = Router();
focusRouter.use(authMiddleware);

const MAX_DURATION_MINUTES = 7 * 24 * 60; // 7 días

focusRouter.post('/enable', async (req: AuthRequest, res) => {
  const { allowedUserIds, durationMinutes } = req.body;

  if (allowedUserIds !== undefined && (!Array.isArray(allowedUserIds) || !allowedUserIds.every((id: any) => typeof id === 'string'))) {
    return res.status(400).json({ error: 'allowedUserIds debe ser una lista de ids' });
  }

  let endsAt: Date | undefined;
  if (durationMinutes !== undefined) {
    const parsed = Number(durationMinutes);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_DURATION_MINUTES) {
      return res.status(400).json({ error: `durationMinutes debe ser un número entre 1 y ${MAX_DURATION_MINUTES}` });
    }
    endsAt = new Date(Date.now() + parsed * 60 * 1000);
  }

  const startsAt = new Date();
  const focus = await prisma.focusMode.upsert({
    where: { userId: req.userId! },
    update: { isEnabled: true, allowedUserIds: allowedUserIds || [], startsAt, endsAt },
    create: { userId: req.userId!, isEnabled: true, allowedUserIds: allowedUserIds || [], startsAt, endsAt }
  });
  return res.json(focus);
});

focusRouter.post('/disable', async (req: AuthRequest, res) => {
  await prisma.focusMode.upsert({
    where: { userId: req.userId! },
    update: { isEnabled: false },
    create: { userId: req.userId!, isEnabled: false }
  });
  return res.json({ enabled: false });
});

focusRouter.get('/status', async (req: AuthRequest, res) => {
  const focus = await prisma.focusMode.findUnique({ where: { userId: req.userId! } });
  return res.json(focus || { isEnabled: false, allowedUserIds: [] });
});

// Función real usada por el sistema de push: decide si hay que notificar o no.
export async function shouldNotify(recipientUserId: string, senderUserId: string): Promise<boolean> {
  const focus = await prisma.focusMode.findUnique({ where: { userId: recipientUserId } });
  if (!focus || !focus.isEnabled) return true;
  if (focus.endsAt && focus.endsAt < new Date()) return true; // ya venció la ventana
  const allowed: string[] = Array.isArray(focus.allowedUserIds) ? (focus.allowedUserIds as string[]) : [];
  return allowed.includes(senderUserId);
}
