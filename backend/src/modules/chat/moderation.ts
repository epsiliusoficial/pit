import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { auditLog } from '../../core/audit/auditLog';

export const moderationRouter = Router();
moderationRouter.use(authMiddleware);

// Sistema "Bloqueo de usuarios": real, se aplica al enviar mensajes (ver tornado/controller).
moderationRouter.post('/block/:userId', async (req: AuthRequest, res) => {
  const { userId } = req.params;
  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: req.userId!, blockedId: userId } },
    update: {},
    create: { blockerId: req.userId!, blockedId: userId }
  });
  return res.json({ blocked: true });
});

moderationRouter.delete('/block/:userId', async (req: AuthRequest, res) => {
  const { userId } = req.params;
  await prisma.block.deleteMany({ where: { blockerId: req.userId!, blockedId: userId } });
  return res.json({ unblocked: true });
});

moderationRouter.get('/blocked', async (req: AuthRequest, res) => {
  const blocked = await prisma.block.findMany({
    where: { blockerId: req.userId! },
    include: { blocked: { select: { id: true, name: true, phone: true } } }
  });
  return res.json(blocked.map((b: any) => b.blocked));
});

// Sistema "Silenciar chat": deja de recibir notificaciones sin salir del chat.
moderationRouter.post('/mute/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const { muted } = req.body;

  // Bug real corregido: antes se llamaba a .update() directo sin chequear
  // que la membresía existiera — si no pertenecías al chat, Prisma tiraba
  // un error interno (P2025) que terminaba como un 500 feo en vez de un
  // 404 claro.
  const member = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  if (!member) return res.status(404).json({ error: 'No pertenecés a este chat' });

  await prisma.chatUser.update({
    where: { userId_chatId: { userId: req.userId!, chatId } },
    data: { isMuted: !!muted }
  });
  return res.json({ muted: !!muted });
});

// Sistema "Archivar chat": lo saca de la lista principal sin borrar nada.
moderationRouter.post('/archive/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const { archived } = req.body;

  const member = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  if (!member) return res.status(404).json({ error: 'No pertenecés a este chat' });

  await prisma.chatUser.update({
    where: { userId_chatId: { userId: req.userId!, chatId } },
    data: { isArchived: !!archived }
  });
  return res.json({ archived: !!archived });
});

// Sistema "Fijar chat": lo sube arriba de todo en la lista.
moderationRouter.post('/pin-chat/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const { pinned } = req.body;

  const member = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  if (!member) return res.status(404).json({ error: 'No pertenecés a este chat' });

  await prisma.chatUser.update({
    where: { userId_chatId: { userId: req.userId!, chatId } },
    data: { isPinned: !!pinned }
  });
  return res.json({ pinned: !!pinned });
});

// Sistema "Fantasma Total": tus mensajes en este chat se autodestruyen apenas
// el otro los lee — no quedan ni en tu propio historial. Real, se aplica en
// el endpoint de confirmación de lectura (chat/controller.ts).
moderationRouter.post('/ghost-total/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const { enabled } = req.body;

  const member = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  if (!member) return res.status(404).json({ error: 'No pertenecés a este chat' });

  await prisma.chatUser.update({
    where: { userId_chatId: { userId: req.userId!, chatId } },
    data: { autoDeleteAfterRead: !!enabled }
  });
  return res.json({ ghostTotal: !!enabled });
});

moderationRouter.delete('/group/:chatId/member/:userId', async (req: AuthRequest, res) => {
  const { chatId, userId } = req.params;
  const admin = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admins pueden expulsar miembros' });
  await prisma.chatUser.delete({ where: { userId_chatId: { userId, chatId } } });
  await auditLog({ userId: req.userId, action: 'MEMBER_REMOVED', targetId: userId, metadata: { chatId }, ip: req.ip });
  return res.json({ removed: true });
});

// Sistema "Promover/degradar admin" dentro de un grupo.
const VALID_ROLES = ['ADMIN', 'MOD', 'MEMBER'];

moderationRouter.post('/group/:chatId/role/:userId', async (req: AuthRequest, res) => {
  const { chatId, userId } = req.params;
  const { role } = req.body;

  // Bug real corregido: el valor de `role` no se validaba contra ningún enum
  // — un admin podía setear cualquier string arbitrario (o incluso vacío)
  // como rol de otro miembro, corrompiendo la lógica de permisos que
  // depende de comparar exactamente contra 'ADMIN' en otros endpoints.
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role debe ser uno de: ${VALID_ROLES.join(', ')}` });
  }

  const admin = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admins pueden cambiar roles' });
  await prisma.chatUser.update({ where: { userId_chatId: { userId, chatId } }, data: { role } });
  await auditLog({ userId: req.userId, action: 'ROLE_CHANGED', targetId: userId, metadata: { chatId, newRole: role }, ip: req.ip });
  return res.json({ role });
});
