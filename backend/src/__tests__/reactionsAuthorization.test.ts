export {}; // fuerza scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockMessageFindUnique = jest.fn();
const mockChatUserFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    message: { findUnique: (...args: any[]) => mockMessageFindUnique(...args) },
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    reaction: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn(), findMany: jest.fn().mockResolvedValue([]) }
  }
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Reacciones — autorización corregida (bug real encontrado)', () => {
  beforeEach(() => {
    mockMessageFindUnique.mockReset();
    mockChatUserFindUnique.mockReset();
  });

  it('rechaza reaccionar a un mensaje de un chat al que no pertenece', async () => {
    const { reactionRouter } = await import('../modules/chat/reactions');
    const handler = getHandler(reactionRouter, '/:messageId');

    mockMessageFindUnique.mockResolvedValue({ id: 'msg1', chatId: 'chat-ajeno' });
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'atacante', params: { messageId: 'msg1' }, body: { emoji: '👍' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rechaza un emoji inválido (demasiado largo)', async () => {
    const { reactionRouter } = await import('../modules/chat/reactions');
    const handler = getHandler(reactionRouter, '/:messageId');

    const req: any = { userId: 'user1', params: { messageId: 'msg1' }, body: { emoji: 'a'.repeat(100) } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
