// Sistema "Grupos con Fecha de Vencimiento" (nuevo): para grupos que tienen
// un propósito con fecha clara — el viaje a Bariloche, el asado del sábado,
// la organización de un evento puntual — un admin puede ponerle una fecha
// de vencimiento al grupo. Cuando esa fecha llega, un worker diario lo
// archiva solo para todos los miembros (no lo borra: la conversación sigue
// existiendo y accesible, solo deja de aparecer activo en la lista
// principal), así el grupo no queda dando vueltas para siempre una vez que
// cumplió su propósito.
//
// Guardado en Chat.groupConfig.expiresAt (mismo campo Json que ya usan
// Mensajes Fijados, Roles Personalizados, Solicitudes de Unión y Notas
// Compartidas).
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const groupExpirationRouter = Router();
groupExpirationRouter.use(authMiddleware);

const MAX_DAYS = 365 * 2;

groupExpirationRouter.post('/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const { expiresAt } = req.body; // null/undefined para cancelar el vencimiento

  const admin = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admins pueden fijar el vencimiento del grupo' });

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat || !chat.isGroup) return res.status(400).json({ error: 'Solo aplica a grupos' });

  const groupConfig = { ...(chat.groupConfig as any || {}) };

  if (expiresAt === null || expiresAt === undefined) {
    delete groupConfig.expiresAt;
    await prisma.chat.update({ where: { id: chatId }, data: { groupConfig } });
    return res.json({ expiresAt: null });
  }

  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'expiresAt no es una fecha válida' });
  if (parsed.getTime() <= Date.now()) return res.status(400).json({ error: 'expiresAt tiene que ser una fecha futura' });
  if (parsed.getTime() - Date.now() > MAX_DAYS * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: `expiresAt no puede estar a más de ${MAX_DAYS} días` });
  }

  groupConfig.expiresAt = parsed.toISOString();
  await prisma.chat.update({ where: { id: chatId }, data: { groupConfig } });
  return res.json({ expiresAt: groupConfig.expiresAt });
});

// Worker: corre una vez al día (ver index.ts) — archiva para todos los
// miembros los grupos cuya fecha de vencimiento ya pasó.
export async function archiveExpiredGroups() {
  const groups = await prisma.chat.findMany({ where: { isGroup: true } });
  for (const group of groups) {
    const expiresAt = (group.groupConfig as any)?.expiresAt;
    if (!expiresAt || new Date(expiresAt).getTime() > Date.now()) continue;

    await prisma.chatUser.updateMany({ where: { chatId: group.id }, data: { isArchived: true } });
    const groupConfig = { ...(group.groupConfig as any) };
    delete groupConfig.expiresAt;
    groupConfig.archivedByExpiration = true;
    await prisma.chat.update({ where: { id: group.id }, data: { groupConfig } });
  }
}
