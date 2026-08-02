export {}; // scope de módulo propio

const mockMessageCreate = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockChatUserFindMany = jest.fn();
const mockBlockFindUnique = jest.fn();
const mockUserFindUnique = jest.fn();
const mockRegisterActivity = jest.fn();
const mockSendPush = jest.fn().mockResolvedValue(undefined);
const mockEmit = jest.fn();

jest.mock('../index', () => ({ io: { to: () => ({ emit: mockEmit }) } }));
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
jest.mock('../modules/social/achievements', () => ({
  registerActivity: (...args: any[]) => mockRegisterActivity(...args),
  BADGES: { STREAK_7: { label: '🔥🔥 Una semana seguida' } }
}));
jest.mock('../modules/chat/rateLimiter', () => ({ rateLimiter: (_req: any, _res: any, next: any) => next() }));
jest.mock('../core/validation/schemas', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
  sendMessageSchema: {},
  createChatSchema: {}
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// Da lugar a que se resuelvan las promesas fire-and-forget dentro del handler.
function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('Notificación de logros al mandar un mensaje (funcionalidad completada — antes se descartaba el resultado)', () => {
  beforeEach(() => {
    mockMessageCreate.mockReset();
    mockChatUserFindUnique.mockReset();
    mockChatUserFindMany.mockReset();
    mockBlockFindUnique.mockReset();
    mockUserFindUnique.mockReset();
    mockRegisterActivity.mockReset();
    mockSendPush.mockClear();
    mockEmit.mockClear();

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatUserFindMany.mockResolvedValue([]);
    mockBlockFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ name: 'Mateo' });
    mockMessageCreate.mockResolvedValue({ id: 'msg1', content: 'x', chatId: 'chat1' });
  });

  it('avisa por socket y por push cuando se desbloquea un logro nuevo', async () => {
    mockRegisterActivity.mockResolvedValue({ streak: 7, unlocked: ['STREAK_7'] });
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: 'Hola' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    await flushPromises();

    expect(mockEmit).toHaveBeenCalledWith('achievement_unlocked', { code: 'STREAK_7', label: '🔥🔥 Una semana seguida' });
    expect(mockSendPush).toHaveBeenCalledWith('user1', '¡Logro desbloqueado! 🏆', '🔥🔥 Una semana seguida');
  });

  it('no avisa nada si no se desbloqueó ningún logro nuevo', async () => {
    mockRegisterActivity.mockResolvedValue({ streak: 7, unlocked: [] });
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: 'Hola' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    await flushPromises();

    expect(mockEmit).not.toHaveBeenCalledWith('achievement_unlocked', expect.anything());
  });
});
