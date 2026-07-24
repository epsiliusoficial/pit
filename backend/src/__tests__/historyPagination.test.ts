export {}; // fuerza scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockChatUserFindUnique = jest.fn();
const mockMessageFindMany = jest.fn();
const mockMessageFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    message: {
      findMany: (...args: any[]) => mockMessageFindMany(...args),
      findUnique: (...args: any[]) => mockMessageFindUnique(...args)
    }
  }
}));

jest.mock('../modules/chat/rateLimiter', () => ({ rateLimiter: (_req: any, _res: any, next: any) => next() }));
jest.mock('../modules/social/achievements', () => ({ registerActivity: jest.fn() }));
jest.mock('../core/validation/schemas', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
  sendMessageSchema: {},
  createChatSchema: {}
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Historial — paginación con cursor y límite máximo (mejora real)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockMessageFindMany.mockReset();
    mockMessageFindUnique.mockReset();
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
  });

  it('limita el `limit` a un máximo de 100, sin importar lo que pida el cliente', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/:chatId/history');

    mockMessageFindMany.mockResolvedValue([]);

    const req: any = { userId: 'user1', params: { chatId: 'chat1' }, query: { limit: '999999999' } };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    expect(mockMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });

  it('usa el cursor `before` para traer solo mensajes anteriores a ese ID', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/:chatId/history');

    const cursorDate = new Date('2024-01-01T00:00:00Z');
    mockMessageFindUnique.mockResolvedValue({ id: 'msg50', createdAt: cursorDate });
    mockMessageFindMany.mockResolvedValue([]);

    const req: any = { userId: 'user1', params: { chatId: 'chat1' }, query: { before: 'msg50' } };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    expect(mockMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdAt: { lt: cursorDate } })
      })
    );
  });

  it('devuelve hasMore=true cuando la página está llena (probablemente hay más)', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/:chatId/history');

    const fullPage = Array.from({ length: 50 }, (_, i) => ({ id: `msg${i}`, createdAt: new Date(), content: 'hola' }));
    mockMessageFindMany.mockResolvedValue(fullPage);

    const req: any = { userId: 'user1', params: { chatId: 'chat1' }, query: {} };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ hasMore: true })
    );
  });
});
