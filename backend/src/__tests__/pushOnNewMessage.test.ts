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
    mockMessageCreate.mockResolvedValue({ id: 'msg1', content: 'envelope-cifrado', chatId: 'chat1' });
  });

  it('notifica a todos los otros miembros del chat, no al que envía', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: 'envelope-cifrado' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockSendPush).toHaveBeenCalledTimes(2);
    // El servidor ya no lee el contenido (E2E real) — el push es genérico,
    // igual que hace Signal, en vez de mostrar un preview del texto real.
    expect(mockSendPush).toHaveBeenCalledWith('otro-user-1', 'Mateo', 'Te envió un mensaje', 'user1');
    expect(mockSendPush).toHaveBeenCalledWith('otro-user-2', 'Mateo', 'Te envió un mensaje', 'user1');
  });

  it('no bloquea la respuesta al usuario si el envío de push falla', async () => {
    mockSendPush.mockRejectedValue(new Error('push service caído'));
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: 'envelope-cifrado' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    // El servidor ya no puede devolver el texto plano (nunca lo tuvo) —
    // devuelve el mismo sobre cifrado que mandó el cliente.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ content: 'envelope-cifrado' }));
  });
});
