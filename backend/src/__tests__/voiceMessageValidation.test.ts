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

describe('Sistema de Mensajes de Voz — validación real de metadata (sistema nuevo)', () => {
  beforeEach(() => {
    mockMessageCreate.mockReset();
    mockChatUserFindUnique.mockReset();
    mockChatUserFindMany.mockReset();
    mockBlockFindUnique.mockReset();
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER', chat: { groupConfig: null } });
    mockChatUserFindMany.mockResolvedValue([]);
  });

  it('rechaza un mensaje VOICE sin fileId/fileKey', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    const req: any = {
      userId: 'user1',
      body: { chatId: 'chat1', content: '🎤 nota de voz', contentType: 'VOICE', metadata: { durationSec: 5 } }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it('rechaza una nota de voz de más de 5 minutos', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    const req: any = {
      userId: 'user1',
      body: {
        chatId: 'chat1', content: '🎤 nota de voz', contentType: 'VOICE',
        metadata: { fileId: 'abc', fileKey: 'def', durationSec: 400 }
      }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it('acepta una nota de voz válida con toda la metadata correcta', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');
    mockMessageCreate.mockResolvedValue({ id: 'm1', chatId: 'chat1', contentType: 'VOICE' });

    const req: any = {
      userId: 'user1',
      body: {
        chatId: 'chat1', content: '🎤 nota de voz', contentType: 'VOICE',
        metadata: { fileId: 'abc', fileKey: 'def', durationSec: 12, waveform: [1, 2, 3] }
      }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contentType: 'VOICE' }) })
    );
  });

  it('no aplica la validación de voz a mensajes de texto normales', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');
    mockMessageCreate.mockResolvedValue({ id: 'm1', chatId: 'chat1', contentType: 'TEXT' });

    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: 'hola normal' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockMessageCreate).toHaveBeenCalled();
  });
});
