// Sistema "Reportes/Denuncias": real, con cola de revisión para admins.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { safeCompare } from '../../core/utils/safeCompare';

export const reportRouter = Router();
reportRouter.use(authMiddleware);

const MAX_REASON_LENGTH = 1000;

reportRouter.post('/', async (req: AuthRequest, res) => {
  const { reportedId, messageId, reason } = req.body;

  // Validación real de entrada — antes `reason` no tenía límite (un string
  // gigante infla la tabla de reportes sin control) y no se chequeaba tipo.
  if (!reportedId || typeof reportedId !== 'string') {
    return res.status(400).json({ error: 'reportedId requerido' });
  }
  if (!reason || typeof reason !== 'string' || reason.length > MAX_REASON_LENGTH) {
    return res.status(400).json({ error: `reason requerido (máximo ${MAX_REASON_LENGTH} caracteres)` });
  }
  // Bug corregido: nada impedía "reportarse a uno mismo", lo cual no tiene
  // sentido y solo ensucia la cola de revisión de los admins.
  if (reportedId === req.userId) {
    return res.status(400).json({ error: 'No podés reportarte a vos mismo' });
  }

  const target = await prisma.user.findUnique({ where: { id: reportedId }, select: { id: true } });
  if (!target) return res.status(404).json({ error: 'El usuario reportado no existe' });

  // Sistema "Anti-spam de denuncias": si ya hay un reporte PENDIENTE del
  // mismo denunciante contra el mismo usuario (y mismo mensaje, si aplica),
  // se devuelve ese en vez de crear duplicados — antes un usuario podía
  // mandar el mismo reporte cientos de veces y saturar la cola de revisión.
  const existing = await prisma.report.findFirst({
    where: { reporterId: req.userId!, reportedId, messageId: messageId ?? null, status: 'PENDING' }
  });
  if (existing) return res.json(existing);

  const report = await prisma.report.create({
    data: { reporterId: req.userId!, reportedId, messageId, reason }
  });
  return res.json(report);
});

// Cola de revisión para admins (protegida con ADMIN_SECRET, igual que el panel admin).
reportRouter.get('/queue', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || !process.env.ADMIN_SECRET || !safeCompare(String(secret), process.env.ADMIN_SECRET)) return res.status(403).json({ error: 'No autorizado' });

  const reports = await prisma.report.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' }
  });
  return res.json(reports);
});

reportRouter.post('/:id/resolve', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || !process.env.ADMIN_SECRET || !safeCompare(String(secret), process.env.ADMIN_SECRET)) return res.status(403).json({ error: 'No autorizado' });

  const { action } = req.body;
  // Bug corregido: cualquier valor de `action` que no fuera 'REVIEWED' caía
  // silenciosamente en DISMISSED — un typo del panel de admin (ej.
  // "REVIEWD") archivaba el reporte como descartado sin que nadie se diera
  // cuenta. Ahora se valida explícitamente contra los dos valores válidos.
  if (action !== 'REVIEWED' && action !== 'DISMISSED') {
    return res.status(400).json({ error: "action debe ser 'REVIEWED' o 'DISMISSED'" });
  }

  const report = await prisma.report.update({
    where: { id: req.params.id },
    data: { status: action }
  }).catch(() => null);
  if (!report) return res.status(404).json({ error: 'Reporte no encontrado' });

  return res.json(report);
});
