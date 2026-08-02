export {}; // scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));
jest.mock('../modules/chat/rateLimiter', () => ({ rateLimiter: (_req: any, _res: any, next: any) => next() }));
jest.mock('../modules/social/achievements', () => ({ registerActivity: jest.fn(), BADGES: {} }));
jest.mock('../core/validation/schemas', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
  sendMessageSchema: {},
  createChatSchema: {}
}));

const mockChatUserFindUnique = jest.fn();
const mockMessageFindUnique = jest.fn();
const mockMessageFindMany = jest.fn();
const mockChatUpdate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    message: {
      findUnique: (...args: any[]) => mockMessageFindUnique(...args),
      findMany: (...args: any[]) => mockMessageFindMany(...args)
    },
    chat: { update: (...args: any[]) => mockChatUpdate(...args) }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Múltiples Mensajes Fijados — mejora real (antes se perdía el anterior)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockMessageFindUnique.mockReset();
    mockMessageFindMany.mockReset();
    mockChatUpdate.mockReset();
  });

  it('rechaza fijar si no sos ADMIN del chat', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, 'post', '/pin/:chatId/:messageId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { chatId: 'chatA', messageId: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it('fija un segundo mensaje SIN perder el primero (el bug real que existía)', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, 'post', '/pin/:chatId/:messageId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN', chat: { groupConfig: { pinnedMessageIds: ['m1'] } } });
    mockMessageFindUnique.mockResolvedValue({ id: 'm2', chatId: 'chatA', isDeleted: false });

    const req: any = { userId: 'admin1', params: { chatId: 'chatA', messageId: 'm2' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ groupConfig: { pinnedMessageIds: ['m1', 'm2'] } }) })
    );
    expect(res.json).toHaveBeenCalledWith({ pinned: true, pinnedMessageIds: ['m1', 'm2'] });
  });

  it('respeta el máximo de 20 mensajes fijados por chat', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, 'post', '/pin/:chatId/:messageId');
    const yaLlenos = Array.from({ length: 20 }, (_, i) => `m${i}`);
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN', chat: { groupConfig: { pinnedMessageIds: yaLlenos } } });
    mockMessageFindUnique.mockResolvedValue({ id: 'm21', chatId: 'chatA', isDeleted: false });

    const req: any = { userId: 'admin1', params: { chatId: 'chatA', messageId: 'm21' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it('desfijar uno no afecta a los demás', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, 'delete', '/pin/:chatId/:messageId');
    mockChatUserFindUnique.mockResolvedValue({
      role: 'ADMIN',
      chat: { groupConfig: { pinnedMessageIds: ['m1', 'm2', 'm3'] }, pinnedMsgId: 'm2' }
    });

    const req: any = { userId: 'admin1', params: { chatId: 'chatA', messageId: 'm2' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ groupConfig: { pinnedMessageIds: ['m1', 'm3'] } }) })
    );
  });

  it('lista los mensajes fijados tal cual (sin descifrar, E2E real), solo si sos miembro del chat', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, 'get', '/pins/:chatId');

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER', chat: { groupConfig: { pinnedMessageIds: ['m1'] } } });
    mockMessageFindMany.mockResolvedValue([{ id: 'm1', content: 'envelope-cifrado', isDeleted: false }]);

    const req: any = { userId: 'user1', params: { chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ pinned: [expect.objectContaining({ id: 'm1', content: 'envelope-cifrado' })] });
  });
});
