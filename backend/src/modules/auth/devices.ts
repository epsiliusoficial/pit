// Sistema "Multi-Dispositivo": lista y revoca sesiones activas, como en apps grandes.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from './middleware';

export const deviceRouter = Router();
deviceRouter.use(authMiddleware);

deviceRouter.post('/register', async (req: AuthRequest, res) => {
  const { deviceName, userAgent } = req.body;
  if (deviceName !== undefined && (typeof deviceName !== 'string' || deviceName.length > 100)) {
    return res.status(400).json({ error: 'deviceName debe ser texto de hasta 100 caracteres' });
  }
  if (userAgent !== undefined && (typeof userAgent !== 'string' || userAgent.length > 300)) {
    return res.status(400).json({ error: 'userAgent debe ser texto de hasta 300 caracteres' });
  }
  const device = await prisma.device.create({
    data: { userId: req.userId!, deviceName: deviceName || 'Dispositivo sin nombre', userAgent }
  });
  return res.json(device);
});

deviceRouter.get('/', async (req: AuthRequest, res) => {
  const devices = await prisma.device.findMany({ where: { userId: req.userId! }, orderBy: { lastActive: 'desc' } });
  return res.json(devices);
});

deviceRouter.delete('/:id', async (req: AuthRequest, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device || device.userId !== req.userId) return res.status(403).json({ error: 'No autorizado' });
  await prisma.device.delete({ where: { id: req.params.id } });
  return res.json({ revoked: true });
});
