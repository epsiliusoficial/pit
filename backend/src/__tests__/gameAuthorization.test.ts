export {}; // fuerza scope de módulo (sin esto, choca con otros test files que también declaran getHandler)

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockChatUserFindUnique = jest.fn();
const mockGameFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    game: { findUnique: (...args: any[]) => mockGameFindUnique(...args) }
  }
}));

jest.mock('../modules/games/chess', () => ({
  createChessGame: jest.fn(),
  makeMove: jest.fn()
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Ajedrez — autorización corregida (bug real encontrado)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockGameFindUnique.mockReset();
  });

  it('rechaza crear una partida en un chat al que el solicitante no pertenece', async () => {
    const { gameRouter } = await import('../modules/games/controller');
    const handler = getHandler(gameRouter, 'post', '/chess/create');

    mockChatUserFindUnique.mockResolvedValue(null); // ni el solicitante ni el oponente pertenecen

    const req: any = { userId: 'atacante', body: { chatId: 'chat-ajeno', opponentId: 'victima' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rechaza ver el replay de una partida en la que el usuario no participó', async () => {
    const { gameRouter } = await import('../modules/games/controller');
    const handler = getHandler(gameRouter, 'get', '/replay/:id');

    mockGameFindUnique.mockResolvedValue({ id: 'game1', player1Id: 'alice', player2Id: 'bob', moves: ['e4', 'e5'] });

    const req: any = { userId: 'un-tercero-sin-relacion', params: { id: 'game1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('permite ver el replay a uno de los dos jugadores reales', async () => {
    const { gameRouter } = await import('../modules/games/controller');
    const handler = getHandler(gameRouter, 'get', '/replay/:id');

    mockGameFindUnique.mockResolvedValue({ id: 'game1', player1Id: 'alice', player2Id: 'bob', moves: ['e4', 'e5'] });

    const req: any = { userId: 'alice', params: { id: 'game1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ moves: ['e4', 'e5'] });
  });
});
