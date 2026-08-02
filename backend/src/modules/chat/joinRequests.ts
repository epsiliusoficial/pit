// Sistema "Solicitud de Unión con Aprobación" (nuevo): un admin puede activar
// que su grupo NO se una directo por link de invitación — en cambio, quien
// entra queda en una lista de espera hasta que un admin lo apruebe o
// rechace. Útil para comunidades grandes donde el link circula libremente
// pero el admin quiere filtrar quién entra de verdad.
//
// El toggle y la cola de espera viven en Chat.groupConfig (Json que ya
// existía, mismo campo que Mensajes Fijados y Roles Personalizados) —
// requireApproval: boolean, joinRequests: [{userId, requestedAt}]. El
// cambio real en el flujo de aceptar invitación está en invites.ts, ahí
// mismo documentado — por defecto (requireApproval ausente) nada cambia.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const joinRequestsRouter = Router();
joinRequestsRouter.use(authMiddleware);

async function requireAdmin(chatId: string, userId: string) {
  const member = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId, chatId } } });
  return member?.role === 'ADMIN';
}

joinRequestsRouter.post('/:chatId/toggle', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const { requireApproval } = req.body;

  if (!(await requireAdmin(chatId, req.userId!))) {
    return res.status(403).json({ error: 'Solo admins pueden activar la aprobación de unión' });
  }

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat || !chat.isGroup) return res.status(400).json({ error: 'Solo aplica a grupos' });

  const groupConfig = { ...(chat.groupConfig as any || {}), requireApproval: !!requireApproval };
  await prisma.chat.update({ where: { id: chatId }, data: { groupConfig } });
  return res.json({ requireApproval: !!requireApproval });
});

joinRequestsRouter.get('/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  if (!(await requireAdmin(chatId, req.userId!))) {
    return res.status(403).json({ error: 'Solo admins pueden ver la lista de espera' });
  }

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  const joinRequests = (chat?.groupConfig as any)?.joinRequests || [];
  return res.json({ joinRequests });
});

joinRequestsRouter.post('/:chatId/:userId/approve', async (req: AuthRequest, res) => {
  const { chatId, userId } = req.params;
  if (!(await requireAdmin(chatId, req.userId!))) {
    return res.status(403).json({ error: 'Solo admins pueden aprobar solicitudes' });
  }

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  const groupConfig = { ...(chat?.groupConfig as any || {}) };
  const joinRequests: any[] = groupConfig.joinRequests || [];
  if (!joinRequests.some((r) => r.userId === userId)) {
    return res.status(404).json({ error: 'No hay una solicitud pendiente de esa persona' });
  }
  groupConfig.joinRequests = joinRequests.filter((r) => r.userId !== userId);

  await prisma.$transaction([
    prisma.chat.update({ where: { id: chatId }, data: { groupConfig } }),
    prisma.chatUser.create({ data: { userId, chatId, role: 'MEMBER' } })
  ]);
  return res.json({ approved: true, userId });
});

joinRequestsRouter.post('/:chatId/:userId/reject', async (req: AuthRequest, res) => {
  const { chatId, userId } = req.params;
  if (!(await requireAdmin(chatId, req.userId!))) {
    return res.status(403).json({ error: 'Solo admins pueden rechazar solicitudes' });
  }

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  const groupConfig = { ...(chat?.groupConfig as any || {}) };
  const joinRequests: any[] = groupConfig.joinRequests || [];
  groupConfig.joinRequests = joinRequests.filter((r) => r.userId !== userId);

  await prisma.chat.update({ where: { id: chatId }, data: { groupConfig } });
  return res.json({ rejected: true, userId });
});
