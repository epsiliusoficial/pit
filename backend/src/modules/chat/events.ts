// Sistema "Eventos con RSVP" (nuevo): mensajes de tipo evento (título, fecha,
// lugar) donde cada miembro del chat puede responder "Voy" / "No puedo" /
// "Tal vez", con conteo en vivo — como los eventos de Facebook/Calendar
// dentro del chat.
//
// Diseño, sin inventar tablas nuevas de Postgres:
// - El evento en sí es un Message normal con contentType 'EVENT' y el
//   título/fecha/lugar en `metadata` (columna JSON que ya existía) — mismo
//   patrón que ya usan los Mensajes de Voz para su metadata.
// - El RSVP reusa la tabla `Reaction` que ya existe (mensajeId + userId +
//   emoji, con índice único) en vez de crear un modelo `EventResponse`
//   nuevo. La diferencia con una reacción común es que acá se fuerza
//   MUTUA EXCLUSIÓN entre las 3 opciones (elegir "Voy" saca automáticamente
//   un "No puedo" previo del mismo usuario) — una reacción común te deja
//   poner varios emojis a la vez, un RSVP no debería.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { io } from '../../index';
import { encryptContent } from '../../core/crypto/messageEncryption';

export const eventRouter = Router();
eventRouter.use(authMiddleware);

const RSVP_EMOJI: Record<string, string> = { GOING: '✅', NOT_GOING: '❌', MAYBE: '🤷' };
const RSVP_EMOJIS = Object.values(RSVP_EMOJI);

async function requireMembership(userId: string, chatId: string) {
  return prisma.chatUser.findUnique({ where: { userId_chatId: { userId, chatId } } });
}

eventRouter.post('/create', async (req: AuthRequest, res) => {
  const { chatId, title, date, location } = req.body;
  if (!chatId || !title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'chatId y title (no vacío) son requeridos' });
  }

  const member = await requireMembership(req.userId!, chatId);
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  // Bug evitado (mismo que ya se corrigió en tareas/encuestas): `new
  // Date('cualquier-cosa')` no tira excepción, da un "Invalid Date" que
  // recién explota más adelante con un 500 genérico si no se valida acá.
  let parsedDate: Date | undefined;
  if (date) {
    parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'date no es una fecha válida' });
    }
  }

  const metadata = { title: title.trim(), date: parsedDate?.toISOString(), location: location || undefined };
  const message = await prisma.message.create({
    data: {
      chatId,
      senderId: req.userId!,
      content: encryptContent(`📅 ${title.trim()}`),
      contentType: 'EVENT',
      metadata
    }
  });

  const messageForClient = { ...message, content: `📅 ${title.trim()}` };
  io.to(chatId).emit('new_message', messageForClient);
  return res.json(messageForClient);
});

eventRouter.post('/:messageId/rsvp', async (req: AuthRequest, res) => {
  const { messageId } = req.params;
  const { response } = req.body;
  if (!response || !RSVP_EMOJI[response]) {
    return res.status(400).json({ error: 'response debe ser GOING, NOT_GOING o MAYBE' });
  }

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.contentType !== 'EVENT') {
    return res.status(404).json({ error: 'Evento no encontrado' });
  }

  const member = await requireMembership(req.userId!, message.chatId);
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const emoji = RSVP_EMOJI[response];

  // Mutua exclusión real: se borran las otras respuestas RSVP de este mismo
  // usuario en este mismo evento ANTES de aplicar la nueva, para que nunca
  // quede alguien contado como "Voy" y "No puedo" a la vez.
  await prisma.reaction.deleteMany({
    where: { messageId, userId: req.userId!, emoji: { in: RSVP_EMOJIS.filter((e) => e !== emoji) } }
  });

  const existing = await prisma.reaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId: req.userId!, emoji } }
  });

  let action: 'added' | 'removed';
  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } });
    action = 'removed'; // tocar de nuevo la misma opción la saca (arrepentirse de haber respondido)
  } else {
    await prisma.reaction.create({ data: { messageId, userId: req.userId!, emoji } });
    action = 'added';
  }

  const allRsvps = await prisma.reaction.findMany({ where: { messageId, emoji: { in: RSVP_EMOJIS } } });
  const counts = { GOING: 0, NOT_GOING: 0, MAYBE: 0 };
  for (const r of allRsvps as any[]) {
    const key = Object.keys(RSVP_EMOJI).find((k) => RSVP_EMOJI[k] === r.emoji);
    if (key) (counts as any)[key]++;
  }

  io.to(message.chatId).emit('event_rsvp_update', { messageId, userId: req.userId, response, action, counts });
  return res.json({ action, counts });
});

eventRouter.get('/:messageId/rsvp', async (req: AuthRequest, res) => {
  const { messageId } = req.params;
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.contentType !== 'EVENT') {
    return res.status(404).json({ error: 'Evento no encontrado' });
  }

  const member = await requireMembership(req.userId!, message.chatId);
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const allRsvps = await prisma.reaction.findMany({ where: { messageId, emoji: { in: RSVP_EMOJIS } } });
  const counts = { GOING: 0, NOT_GOING: 0, MAYBE: 0 };
  const byUser: Record<string, string> = {};
  for (const r of allRsvps as any[]) {
    const key = Object.keys(RSVP_EMOJI).find((k) => RSVP_EMOJI[k] === r.emoji);
    if (key) { (counts as any)[key]++; byUser[r.userId] = key; }
  }
  return res.json({ counts, byUser });
});
