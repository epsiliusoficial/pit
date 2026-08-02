// Sistema "Canales de Difusión" (nuevo): un chat de un solo emisor -> muchos
// oyentes, como los canales de Telegram/WhatsApp Channels. Se apoya en el
// modelo Chat/ChatUser que ya existía — un canal de difusión ES un Chat con
// isGroup:true y groupConfig:{broadcast:true}; los oyentes son ChatUser con
// role:'MEMBER', el dueño es role:'ADMIN'. Enforcement de "solo admin
// publica" vive en chat/controller.ts (POST /send).
//
// Decisión de diseño clave: la privacidad es al revés que en un grupo común.
// En un grupo, ver quién más está es normal. En un canal de difusión de
// 5000 personas, un oyente NO debería poder listar a los otros 4999 (eso
// habilitaría spam/acoso a escala, y es justo lo que la gente espera que NO
// pase en un canal tipo "anuncios"). Por eso /info solo devuelve un
// CONTEO, nunca la lista de userIds, salvo que quien pregunta sea el admin.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const broadcastRouter = Router();
broadcastRouter.use(authMiddleware);

broadcastRouter.post('/create', async (req: AuthRequest, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 80) {
    return res.status(400).json({ error: 'name debe ser un texto no vacío de hasta 80 caracteres' });
  }

  const chat = await prisma.chat.create({
    data: {
      isGroup: true,
      name: name.trim(),
      groupConfig: { broadcast: true },
      users: { create: [{ userId: req.userId!, role: 'ADMIN' }] }
    }
  });
  return res.json({ chatId: chat.id, name: chat.name });
});

// Unirse es de acceso abierto a propósito (como suscribirse a un canal
// público) — no requiere invitación, a diferencia de un grupo normal. Es
// idempotente: sumarse dos veces no duplica nada ni rompe.
broadcastRouter.post('/:chatId/join', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { groupConfig: true } });
  if (!chat || !(chat.groupConfig as any)?.broadcast) {
    return res.status(404).json({ error: 'Canal de difusión no encontrado' });
  }

  const existing = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (existing) return res.json({ joined: true, alreadyMember: true });

  await prisma.chatUser.create({ data: { userId: req.userId!, chatId, role: 'MEMBER' } });
  return res.json({ joined: true, alreadyMember: false });
});

broadcastRouter.post('/:chatId/leave', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.json({ left: true });
  if (member.role === 'ADMIN') {
    return res.status(400).json({ error: 'El administrador no puede abandonar su propio canal; borralo en su lugar' });
  }
  await prisma.chatUser.delete({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  return res.json({ left: true });
});

broadcastRouter.get('/:chatId/info', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No estás suscripto a este canal' });

  const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { name: true, groupConfig: true } });
  if (!chat || !(chat.groupConfig as any)?.broadcast) {
    return res.status(404).json({ error: 'Canal de difusión no encontrado' });
  }

  const followerCount = await prisma.chatUser.count({ where: { chatId } });
  const isAdmin = member.role === 'ADMIN';

  // Privacidad real: la lista de suscriptores NUNCA sale de acá salvo que
  // quien pregunta sea el admin del canal. Un oyente solo ve el conteo.
  const response: any = { chatId, name: chat.name, followerCount, isAdmin };
  if (isAdmin) {
    const followers = await prisma.chatUser.findMany({
      where: { chatId },
      select: { userId: true, role: true, user: { select: { name: true } } }
    });
    response.followers = followers;
  }
  return res.json(response);
});
