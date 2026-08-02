export {}; // fuerza scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockChatUserFindUnique = jest.fn();
const mockChatUserFindMany = jest.fn();
const mockChatFindUnique = jest.fn();
const mockMessageCreate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      findMany: (...args: any[]) => mockChatUserFindMany(...args)
    },
    chat: { findUnique: (...args: any[]) => mockChatFindUnique(...args) },
    message: { create: (...args: any[]) => mockMessageCreate(...args) },
    block: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Test' }) }
  }
}));

jest.mock('../modules/chat/rateLimiter', () => ({ rateLimiter: (_req: any, _res: any, next: any) => next() }));
jest.mock('../modules/social/achievements', () => ({
  registerActivity: jest.fn().mockResolvedValue({ unlocked: [] }),
  BADGES: {}
}));
jest.mock('../modules/notifications/push', () => ({ sendPushNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../core/validation/schemas', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
  sendMessageSchema: {},
  createChatSchema: {}
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Canales de Difusión — enforcement en /send (solo admin publica)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockChatUserFindMany.mockReset();
    mockChatFindUnique.mockReset();
    mockMessageCreate.mockReset();
    mockChatUserFindMany.mockResolvedValue([]); // sin otros miembros por defecto (evita ramas de bloqueo)
  });

  it('rechaza el envío de un oyente MEMBER en un canal de difusión', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER', chat: { groupConfig: { broadcast: true } } });

    const req: any = { userId: 'oyente1', body: { chatId: 'canalX', content: 'quiero anunciar algo' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it('permite el envío del ADMIN en un canal de difusión', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN', chat: { groupConfig: { broadcast: true } } });
    mockMessageCreate.mockResolvedValue({ id: 'm1', chatId: 'canalX', senderId: 'admin1' });

    const req: any = { userId: 'admin1', body: { chatId: 'canalX', content: 'Anuncio oficial' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockMessageCreate).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('no aplica la restricción en un chat normal (no broadcast)', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER', chat: { groupConfig: null } });
    mockMessageCreate.mockResolvedValue({ id: 'm1', chatId: 'chatNormal', senderId: 'user1' });

    const req: any = { userId: 'user1', body: { chatId: 'chatNormal', content: 'hola' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockMessageCreate).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});
