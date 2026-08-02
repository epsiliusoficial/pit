import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { createChessGame, makeMove } from './chess';
import { io } from '../../index';
import { prisma } from '../../core/database/client';

export const gameRouter = Router();
gameRouter.use(authMiddleware);

gameRouter.post('/chess/create', async (req: AuthRequest, res) => {
  const { chatId, opponentId } = req.body;
  if (!chatId || !opponentId) return res.status(400).json({ error: 'chatId y opponentId requeridos' });
  if (opponentId === req.userId) return res.status(400).json({ error: 'No podés jugar contra vos mismo' });

  // Bug real corregido: antes no se verificaba que ninguno de los dos jugadores
  // perteneciera al chat — cualquier usuario autenticado podía crear partidas
  // en chats ajenos e inyectar eventos game_created a gente que no lo invitó.
  const [requesterMembership, opponentMembership] = await Promise.all([
    prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } }),
    prisma.chatUser.findUnique({ where: { userId_chatId: { userId: opponentId, chatId } } })
  ]);
  if (!requesterMembership) return res.status(403).json({ error: 'No pertenecés a este chat' });
  if (!opponentMembership) return res.status(400).json({ error: 'El oponente no pertenece a este chat' });

  const game = await createChessGame(chatId, req.userId!, opponentId);
  io.to(chatId).emit('game_created', game);
  return res.json(game);
});

gameRouter.post('/chess/:id/move', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { from, to, promotion } = req.body;
  try {
    const game = await makeMove(id, req.userId!, from, to, promotion);
    io.to(game.chatId).emit('game_move', game);
    return res.json(game);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

gameRouter.get('/replay/:id', async (req: AuthRequest, res) => {
  const game = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!game) return res.status(404).json({ error: 'No encontrado' });

  // Bug real corregido: antes cualquier usuario autenticado podía leer el
  // replay de CUALQUIER partida por ID, sin importar si participó o no —
  // una fuga de información entre usuarios sin relación entre sí.
  if (game.player1Id !== req.userId && game.player2Id !== req.userId) {
    return res.status(403).json({ error: 'No participaste en esta partida' });
  }

  return res.json({ moves: game.moves });
});
