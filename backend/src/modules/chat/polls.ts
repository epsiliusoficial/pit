// Sistema "Encuestas ponderadas" (#51 de la idea original de Pit): los admins
// pesan el doble en la votación. Es real: se calcula en la consulta de resultados.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { io } from '../../index';

export const pollRouter = Router();
pollRouter.use(authMiddleware);

pollRouter.post('/create', async (req: AuthRequest, res) => {
  const { chatId, question, options, closesInSeconds } = req.body;
  if (!chatId || !question || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'chatId, question y al menos 2 options requeridos' });
  }

  // Bug real corregido: antes cualquier usuario autenticado podía crear
  // encuestas en CUALQUIER chat, sin importar si pertenecía o no.
  const membership = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!membership) return res.status(403).json({ error: 'No pertenecés a este chat' });

  // Bug corregido (mismo patrón que ya se arregló en invitaciones y tareas):
  // closesInSeconds no se validaba — un valor negativo, NaN o gigante
  // pasaba directo a la fecha de cierre sin ningún chequeo.
  let closesAt: Date | undefined;
  if (closesInSeconds !== undefined) {
    const parsed = Number(closesInSeconds);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 30 * 24 * 60 * 60) {
      return res.status(400).json({ error: 'closesInSeconds debe ser un número entre 1 y 30 días (en segundos)' });
    }
    closesAt = new Date(Date.now() + parsed * 1000);
  }

  const poll = await prisma.poll.create({
    data: {
      chatId,
      question,
      options,
      createdBy: req.userId!,
      closesAt
    }
  });
  io.to(chatId).emit('poll_created', poll);
  return res.json(poll);
});

pollRouter.post('/:id/vote', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { optionIndex } = req.body;
  const poll = await prisma.poll.findUnique({ where: { id } });
  if (!poll) return res.status(404).json({ error: 'Encuesta no encontrada' });
  if (poll.closesAt && poll.closesAt < new Date()) return res.status(400).json({ error: 'Encuesta cerrada' });

  // Bug real corregido: antes, si `membership` era null (usuario no pertenece
  // al chat), el peso caía a 1 por el operador `?.` en vez de RECHAZAR el
  // voto — cualquiera podía votar encuestas de chats ajenos.
  const membership = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId: poll.chatId } }
  });
  if (!membership) return res.status(403).json({ error: 'No pertenecés a este chat' });

  // Bug real corregido: no se validaba que optionIndex existiera realmente
  // entre las opciones de la encuesta — se podía insertar un índice
  // arbitrario (ej: 9999) y corromper los resultados.
  const options = poll.options as unknown as any[];
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
    return res.status(400).json({ error: 'optionIndex inválido para esta encuesta' });
  }

  const weight = membership.role === 'ADMIN' ? 2 : 1; // ponderación real por rol

  const vote = await prisma.pollVote.upsert({
    where: { pollId_userId: { pollId: id, userId: req.userId! } },
    update: { optionIndex, weight },
    create: { pollId: id, userId: req.userId!, optionIndex, weight }
  });

  const allVotes = await prisma.pollVote.findMany({ where: { pollId: id } });
  const results: Record<number, number> = {};
  allVotes.forEach((v: any) => { results[v.optionIndex] = (results[v.optionIndex] || 0) + v.weight; });

  io.to(poll.chatId).emit('poll_updated', { pollId: id, results });
  return res.json({ vote, results });
});

pollRouter.get('/:id/results', async (req: AuthRequest, res) => {
  const { id } = req.params;

  const poll = await prisma.poll.findUnique({ where: { id } });
  if (!poll) return res.status(404).json({ error: 'Encuesta no encontrada' });

  // Bug real corregido: cualquier usuario autenticado podía leer los
  // resultados de encuestas de chats a los que no pertenece.
  const membership = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId: poll.chatId } }
  });
  if (!membership) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const votes = await prisma.pollVote.findMany({ where: { pollId: id } });
  const results: Record<number, number> = {};
  votes.forEach((v: any) => { results[v.optionIndex] = (results[v.optionIndex] || 0) + v.weight; });
  return res.json({ results, totalVotes: votes.length });
});
