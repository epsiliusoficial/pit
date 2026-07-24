export {}; // scope de módulo propio

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockMessageCreate = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockChatUserFindMany = jest.fn();
const mockBlockFindUnique = jest.fn();
const mockUserFindUnique = jest.fn();
const mockSendPush = jest.fn().mockResolvedValue(undefined);

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
jest.mock('../modules/notifications/push', () => ({ sendPushNotification: (...args: any[]) => mockSendPush(...args) }));
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

describe('Push notifications al mandar un mensaje (bug real corregido — antes nunca se disparaban)', () => {
  beforeEach(() => {
    mockMessageCreate.mockReset();
    mockChatUserFindUnique.mockReset();
    mockChatUserFindMany.mockReset();
    mockBlockFindUnique.mockReset();
    mockUserFindUnique.mockReset();
    mockSendPush.mockClear();

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatUserFindMany.mockResolvedValue([{ userId: 'otro-user-1' }, { userId: 'otro-user-2' }]);
    mockBlockFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ name: 'Mateo' });
    mockMessageCreate.mockResolvedValue({ id: 'msg1', content: 'x', chatId: 'chat1' });
  });

  it('notifica a todos los otros miembros del chat, no al que envía', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: 'Hola grupo' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockSendPush).toHaveBeenCalledTimes(2);
    expect(mockSendPush).toHaveBeenCalledWith('otro-user-1', 'Mateo', 'Hola grupo', 'user1');
    expect(mockSendPush).toHaveBeenCalledWith('otro-user-2', 'Mateo', 'Hola grupo', 'user1');
  });

  it('trunca el preview de mensajes largos a 100 caracteres', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    const longContent = 'x'.repeat(200);
    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: longContent } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const previewArg = mockSendPush.mock.calls[0][2];
    expect(previewArg.length).toBeLessThanOrEqual(101); // 100 + '…'
  });

  it('no bloquea la respuesta al usuario si el envío de push falla', async () => {
    mockSendPush.mockRejectedValue(new Error('push service caído'));
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: 'Hola' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hola' }));
  });
});
