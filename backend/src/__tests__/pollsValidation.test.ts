export {}; // scope de módulo propio

const mockChatUserFindUnique = jest.fn();
const mockPollCreate = jest.fn();
jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    poll: { create: (...args: any[]) => mockPollCreate(...args) }
  }
}));
jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Encuestas — validación de closesInSeconds (bug real corregido)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockPollCreate.mockReset();
    mockChatUserFindUnique.mockResolvedValue({ userId: 'u1', chatId: 'chat1' });
  });

  it('rechaza closesInSeconds negativo', async () => {
    const { pollRouter } = await import('../modules/chat/polls');
    const handler = getHandler(pollRouter, 'post', '/create');
    const req: any = { userId: 'u1', body: { chatId: 'chat1', question: '¿Pizza?', options: ['sí', 'no'], closesInSeconds: -10 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPollCreate).not.toHaveBeenCalled();
  });

  it('rechaza closesInSeconds por encima del máximo (30 días)', async () => {
    const { pollRouter } = await import('../modules/chat/polls');
    const handler = getHandler(pollRouter, 'post', '/create');
    const req: any = { userId: 'u1', body: { chatId: 'chat1', question: '¿Pizza?', options: ['sí', 'no'], closesInSeconds: 99999999 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('acepta un closesInSeconds válido', async () => {
    mockPollCreate.mockResolvedValue({ id: 'poll1' });
    const { pollRouter } = await import('../modules/chat/polls');
    const handler = getHandler(pollRouter, 'post', '/create');
    const req: any = { userId: 'u1', body: { chatId: 'chat1', question: '¿Pizza?', options: ['sí', 'no'], closesInSeconds: 3600 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    expect(mockPollCreate).toHaveBeenCalled();
  });
});
