export {}; // scope de módulo propio

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockMessageCreate = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockChatUserFindMany = jest.fn();
const mockBlockFindUnique = jest.fn();
const mockUserFindUnique = jest.fn();
const mockQueueRetry = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      findMany: (...args: any[]) => mockChatUserFindMany(...args)
    },
    block: { findUnique: (...args: any[]) => mockBlockFindUnique(...args) },
    message: { create: (...args: any[]) => mockMessageCreate(...args) },
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) }
  }
}));
jest.mock('../modules/chat/tornado', () => ({ queueRetry: (...args: any[]) => mockQueueRetry(...args) }));
jest.mock('../modules/notifications/push', () => ({ sendPushNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../modules/chat/rateLimiter', () => ({ rateLimiter: (_req: any, _res: any, next: any) => next() }));
jest.mock('../modules/social/achievements', () => ({ registerActivity: jest.fn().mockResolvedValue({ streak: 1, unlocked: [] }) }));
jest.mock('../core/validation/schemas', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
  sendMessageSchema: {},
  createChatSchema: {}
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('POST /chat/send — fallo total (bug real corregido: antes se colgaba sin responder)', () => {
  beforeEach(() => {
    mockMessageCreate.mockReset();
    mockChatUserFindUnique.mockReset();
    mockChatUserFindMany.mockReset();
    mockBlockFindUnique.mockReset();
    mockUserFindUnique.mockReset();
    mockQueueRetry.mockReset();

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatUserFindMany.mockResolvedValue([]);
    mockBlockFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ name: 'Mateo' });
  });

  it('si la escritura directa falla pero el encolado funciona, responde 202 (comportamiento normal)', async () => {
    mockMessageCreate.mockRejectedValue(new Error('DB caída'));
    mockQueueRetry.mockResolvedValue(undefined);

    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: 'hola' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('si TAMBIÉN falla el encolado, responde 503 en vez de dejar la request colgada', async () => {
    mockMessageCreate.mockRejectedValue(new Error('DB caída'));
    mockQueueRetry.mockRejectedValue(new Error('Redis también caído'));

    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: 'hola' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });
});
