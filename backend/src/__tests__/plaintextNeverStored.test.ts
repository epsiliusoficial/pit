export {}; // fuerza scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockMessageCreate = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockChatUserFindMany = jest.fn();
const mockBlockFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      findMany: (...args: any[]) => mockChatUserFindMany(...args)
    },
    block: { findUnique: (...args: any[]) => mockBlockFindUnique(...args) },
    message: { create: (...args: any[]) => mockMessageCreate(...args) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Mateo' }) }
  }
}));
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

describe('Integración real: el texto plano NUNCA llega a la base de datos', () => {
  beforeEach(() => {
    mockMessageCreate.mockReset();
    mockChatUserFindUnique.mockReset();
    mockChatUserFindMany.mockReset();
    mockBlockFindUnique.mockReset();

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatUserFindMany.mockResolvedValue([{ userId: 'otro-user' }]);
    mockBlockFindUnique.mockResolvedValue(null);
  });

  it('el content que se pasa a prisma.message.create está cifrado, no en texto plano', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    const plainText = 'este es mi mensaje secreto que nadie debería ver en la base';
    mockMessageCreate.mockResolvedValue({ id: 'msg1', content: 'lo-que-sea', chatId: 'chat1' });

    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: plainText } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const callArgs = mockMessageCreate.mock.calls[0][0];
    expect(callArgs.data.content).not.toBe(plainText);
    expect(callArgs.data.content).toMatch(/^enc1:/);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ content: plainText })
    );
  });
});
