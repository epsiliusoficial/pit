import { Chess } from 'chess.js';

// Se mockea el módulo de Prisma completo ANTES de importar chess.ts, así el test
// no depende de tener el engine de Prisma generado (irrelevante para esta prueba,
// que solo verifica la lógica de negocio de makeMove(), no la base de datos real).
jest.mock('../core/database/client', () => ({
  prisma: { game: { findUnique: jest.fn(), update: jest.fn() } }
}));

import { makeMove } from '../modules/games/chess';
import { prisma } from '../core/database/client';

describe('Sistema de Ajedrez (chess.js) — validación de reglas reales', () => {
  it('permite un movimiento de apertura válido', () => {
    const chess = new Chess();
    const move = chess.move({ from: 'e2', to: 'e4' });
    expect(move).not.toBeNull();
  });

  it('rechaza un movimiento ilegal', () => {
    const chess = new Chess();
    expect(() => chess.move({ from: 'e2', to: 'e5' })).toThrow(); // el peón no puede saltar así
  });

  it('detecta jaque mate en el clásico "Fool\'s Mate"', () => {
    const chess = new Chess();
    chess.move('f3');
    chess.move('e5');
    chess.move('g4');
    chess.move('Qh4');
    expect(chess.isCheckmate()).toBe(true);
  });
});

describe('makeMove() — normalización de errores (bug real encontrado y corregido)', () => {
  it('convierte la excepción interna de chess.js en "Movimiento ilegal"', async () => {
    const fakeGame = {
      id: 'game1',
      status: 'ACTIVE',
      currentTurn: 'user1',
      player1Id: 'user1',
      player2Id: 'user2',
      state: { fen: new Chess().fen() },
      moves: []
    };
    (prisma.game.findUnique as jest.Mock).mockResolvedValue(fakeGame);

    await expect(makeMove('game1', 'user1', 'e2', 'e5')).rejects.toThrow('Movimiento ilegal');
  });
});
