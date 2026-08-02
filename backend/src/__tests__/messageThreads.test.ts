export {}; // scope de módulo

const mockMessageFindUnique = jest.fn();
const mockMessageFindMany = jest.fn();
const mockChatUserFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    message: {
      findUnique: (...args: any[]) => mockMessageFindUnique(...args),
      findMany: (...args: any[]) => mockMessageFindMany(...args)
    },
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) }
  }
}));

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));
jest.mock('../modules/chat/rateLimiter', () => ({ rateLimiter: (_req: any, _res: any, next: any) => next() }));
jest.mock('../modules/social/achievements', () => ({ registerActivity: jest.fn(), BADGES: {} }));
jest.mock('../core/validation/schemas', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
  sendMessageSchema: {},
  createChatSchema: {}
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Hilos de Respuesta — sistema nuevo (thread view)', () => {
  beforeEach(() => {
    mockMessageFindUnique.mockReset();
    mockMessageFindMany.mockReset();
    mockChatUserFindUnique.mockReset();
  });

  it('devuelve 404 si el mensaje raíz no existe o está borrado', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/thread/:messageId');
    mockMessageFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { messageId: 'noexiste' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockChatUserFindUnique).not.toHaveBeenCalled();
  });

  it('rechaza si el usuario no pertenece al chat del mensaje raíz', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/thread/:messageId');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', chatId: 'chatX', isDeleted: false, content: 'x' });
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'atacante', params: { messageId: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockMessageFindMany).not.toHaveBeenCalled();
  });

  it('devuelve el mensaje raíz y sus respuestas tal cual (el server ya no descifra, E2E real) y el conteo correcto', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/thread/:messageId');

    mockMessageFindUnique.mockResolvedValue({
      id: 'm1', chatId: 'chatA', isDeleted: false, content: 'envelope-root-cifrado'
    });
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockMessageFindMany.mockResolvedValue([
      { id: 'r1', content: 'envelope-r1-cifrado', replyToId: 'm1' },
      { id: 'r2', content: 'envelope-r2-cifrado', replyToId: 'm1' }
    ]);

    const req: any = { userId: 'user1', params: { messageId: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { replyToId: 'm1', isDeleted: false } })
    );
    const payload = res.json.mock.calls[0][0];
    expect(payload.root.content).toBe('envelope-root-cifrado');
    expect(payload.replyCount).toBe(2);
    expect(payload.replies.map((r: any) => r.content)).toEqual(['envelope-r1-cifrado', 'envelope-r2-cifrado']);
  });
});
