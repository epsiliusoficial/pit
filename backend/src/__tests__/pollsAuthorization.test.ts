export {}; // fuerza scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockChatUserFindUnique = jest.fn();
const mockPollFindUnique = jest.fn();
const mockPollVoteFindMany = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    poll: { create: jest.fn(), findUnique: (...args: any[]) => mockPollFindUnique(...args) },
    pollVote: { upsert: jest.fn(), findMany: (...args: any[]) => mockPollVoteFindMany(...args) }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Encuestas — 3 bugs de autorización corregidos', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockPollFindUnique.mockReset();
    mockPollVoteFindMany.mockReset();
  });

  it('rechaza crear una encuesta en un chat al que no pertenece', async () => {
    const { pollRouter } = await import('../modules/chat/polls');
    const handler = getHandler(pollRouter, 'post', '/create');
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'atacante', body: { chatId: 'chat-ajeno', question: '¿Pizza?', options: ['sí', 'no'] } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rechaza votar si el usuario no pertenece al chat de la encuesta (bug real: antes votaba con peso 1 igual)', async () => {
    const { pollRouter } = await import('../modules/chat/polls');
    const handler = getHandler(pollRouter, 'post', '/:id/vote');

    mockPollFindUnique.mockResolvedValue({ id: 'poll1', chatId: 'chat-ajeno', closesAt: null, options: ['sí', 'no'] });
    mockChatUserFindUnique.mockResolvedValue(null); // no es miembro

    const req: any = { userId: 'atacante', params: { id: 'poll1' }, body: { optionIndex: 0 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rechaza un optionIndex fuera de rango', async () => {
    const { pollRouter } = await import('../modules/chat/polls');
    const handler = getHandler(pollRouter, 'post', '/:id/vote');

    mockPollFindUnique.mockResolvedValue({ id: 'poll1', chatId: 'chat1', closesAt: null, options: ['sí', 'no'] });
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { id: 'poll1' }, body: { optionIndex: 9999 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza leer resultados de una encuesta de un chat ajeno', async () => {
    const { pollRouter } = await import('../modules/chat/polls');
    const handler = getHandler(pollRouter, 'get', '/:id/results');

    mockPollFindUnique.mockResolvedValue({ id: 'poll1', chatId: 'chat-ajeno' });
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'atacante', params: { id: 'poll1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
