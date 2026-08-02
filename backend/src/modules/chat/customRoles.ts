// Sistema "Roles Personalizados de Grupo" (nuevo): hasta ahora un grupo solo
// tenía ADMIN o MIEMBRO — nada en el medio. Esto agrega un rol MODERATOR
// real: alguien de confianza que puede borrar mensajes ajenos para mantener
// el grupo en orden, sin darle el control total de admin (agregar/sacar
// gente, cambiar configuración del grupo, etc. siguen siendo solo de ADMIN).
//
// Corrige además una limitación real que tenía el proyecto: antes, borrar
// un mensaje (DELETE /api/chat/message/:id) SOLO lo podía hacer quien lo
// escribió — ni siquiera un admin del grupo podía borrar un mensaje ajeno
// problemático. Ahora ADMIN y MODERATOR también pueden (ver el cambio en
// chat/controller.ts).
//
// Diseño, sin migraciones nuevas: los roles de moderador se guardan en
// Chat.groupConfig.customRoles = { [userId]: 'MODERATOR' } — mismo campo
// JSON que ya usaba el sistema de Mensajes Fijados, solo una clave más
// adentro del mismo objeto.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const customRolesRouter = Router();
customRolesRouter.use(authMiddleware);

export async function isModerator(chatId: string, userId: string): Promise<boolean> {
  const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { groupConfig: true } });
  const customRoles = (chat?.groupConfig as any)?.customRoles || {};
  return customRoles[userId] === 'MODERATOR';
}

customRolesRouter.get('/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const member = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { groupConfig: true } });
  const customRoles = (chat?.groupConfig as any)?.customRoles || {};
  return res.json({ moderators: Object.keys(customRoles).filter((id) => customRoles[id] === 'MODERATOR') });
});

customRolesRouter.post('/:chatId/:userId', async (req: AuthRequest, res) => {
  const { chatId, userId } = req.params;
  const { role } = req.body; // 'MODERATOR' para asignar, null/undefined para sacarlo

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat || !chat.isGroup) return res.status(400).json({ error: 'Solo aplica a grupos' });

  const admin = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admins pueden asignar roles' });

  const target = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId, chatId } } });
  if (!target) return res.status(404).json({ error: 'Esa persona no es miembro del grupo' });
  if (target.role === 'ADMIN') return res.status(400).json({ error: 'Ya es admin, no necesita el rol de moderador' });

  if (role && role !== 'MODERATOR') return res.status(400).json({ error: 'Único rol personalizado soportado: MODERATOR' });

  const groupConfig = (chat.groupConfig as any) || {};
  const customRoles = groupConfig.customRoles || {};
  if (role === 'MODERATOR') {
    customRoles[userId] = 'MODERATOR';
  } else {
    delete customRoles[userId];
  }
  groupConfig.customRoles = customRoles;

  await prisma.chat.update({ where: { id: chatId }, data: { groupConfig } });
  return res.json({ userId, role: role === 'MODERATOR' ? 'MODERATOR' : null });
});
