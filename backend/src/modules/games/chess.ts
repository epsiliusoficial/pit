import { Chess } from 'chess.js';
import { prisma } from '../../core/database/client';

export async function createChessGame(chatId: string, player1Id: string, player2Id: string) {
  const chess = new Chess();
  return prisma.game.create({
    data: {
      chatId,
      type: 'CHESS',
      state: { fen: chess.fen() },
      player1Id,
      player2Id,
      currentTurn: player1Id,
      moves: []
    }
  });
}

export async function makeMove(gameId: string, userId: string, from: string, to: string, promotion?: string) {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw new Error('Juego no encontrado');
  if (game.status !== 'ACTIVE') throw new Error('Juego finalizado');
  if (game.currentTurn !== userId) throw new Error('No es tu turno');

  const state = game.state as { fen: string };
  const chess = new Chess(state.fen);

  let move;
  try {
    move = chess.move({ from, to, promotion });
  } catch {
    // Esta versión de chess.js lanza excepción en jugada ilegal en vez de
    // devolver null — se normaliza acá para dar siempre el mismo mensaje claro.
    throw new Error('Movimiento ilegal');
  }
  if (!move) throw new Error('Movimiento ilegal');

  const nextTurn = userId === game.player1Id ? game.player2Id : game.player1Id;
  const moves = Array.isArray(game.moves) ? [...(game.moves as any[]), move.san] : [move.san];

  let status = 'ACTIVE';
  let winnerId: string | null = null;
  if (chess.isCheckmate()) {
    status = 'FINISHED';
    winnerId = userId;
  } else if (chess.isDraw() || chess.isStalemate()) {
    status = 'FINISHED';
  }

  return prisma.game.update({
    where: { id: gameId },
    data: {
      state: { fen: chess.fen() },
      currentTurn: nextTurn,
      moves,
      status,
      winnerId: winnerId || undefined
    }
  });
}
