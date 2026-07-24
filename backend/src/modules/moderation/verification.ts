// Sistema "Cuenta Verificada": marca real en BD, solo un admin puede otorgarla.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { auditLog } from '../../core/audit/auditLog';
import { safeCompare } from '../../core/utils/safeCompare';

export const verificationRouter = Router();

function requireAdmin(req: any, res: any, next: any) {
  const secret = req.headers['x-admin-secret'];
  if (!secret || !process.env.ADMIN_SECRET || !safeCompare(String(secret), process.env.ADMIN_SECRET)) return res.status(403).json({ error: 'No autorizado' });
  next();
}

verificationRouter.post('/:userId/verify', requireAdmin, async (req, res) => {
  const exists = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'Usuario no encontrado' });

  const user = await prisma.user.update({
    where: { id: req.params.userId },
    data: { isVerified: true }
  });
  await auditLog({ action: 'USER_VERIFIED', targetId: user.id, ip: req.ip });
  return res.json({ id: user.id, name: user.name, isVerified: user.isVerified });
});

verificationRouter.post('/:userId/unverify', requireAdmin, async (req, res) => {
  const exists = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'Usuario no encontrado' });

  const user = await prisma.user.update({
    where: { id: req.params.userId },
    data: { isVerified: false }
  });
  return res.json({ id: user.id, name: user.name, isVerified: user.isVerified });
});
