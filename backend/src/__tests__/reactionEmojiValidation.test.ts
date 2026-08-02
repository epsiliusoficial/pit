export {}; // scope de módulo propio

const mockMessageFindUnique = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockReactionFindUnique = jest.fn();
const mockReactionCreate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    message: { findUnique: (...args: any[]) => mockMessageFindUnique(...args) },
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    reaction: {
      findUnique: (...args: any[]) => mockReactionFindUnique(...args),
      create: (...args: any[]) => mockReactionCreate(...args),
      findMany: jest.fn().mockResolvedValue([])
    }
  }
}));
jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Reacciones — el emoji debe ser un emoji de verdad (hardening agregado)', () => {
  beforeEach(() => {
    mockMessageFindUnique.mockReset();
    mockChatUserFindUnique.mockReset();
    mockReactionFindUnique.mockReset();
    mockReactionCreate.mockReset();
    mockMessageFindUnique.mockResolvedValue({ id: 'msg1', chatId: 'chat1' });
    mockChatUserFindUnique.mockResolvedValue({ userId: 'user1', chatId: 'chat1' });
    mockReactionFindUnique.mockResolvedValue(null);
    mockReactionCreate.mockResolvedValue({});
  });

  it('rechaza texto que no es un emoji (antes solo se limitaba el largo)', async () => {
    const { reactionRouter } = await import('../modules/chat/reactions');
    const handler = getHandler(reactionRouter, 'post', '/:messageId');

    const req: any = { userId: 'user1', params: { messageId: 'msg1' }, body: { emoji: '<script>' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockReactionCreate).not.toHaveBeenCalled();
  });

  it('acepta emojis reales normales', async () => {
    const { reactionRouter } = await import('../modules/chat/reactions');
    const handler = getHandler(reactionRouter, 'post', '/:messageId');

    for (const emoji of ['👍', '❤️', '🔥', '😂']) {
      const req: any = { userId: 'user1', params: { messageId: 'msg1' }, body: { emoji } };
      const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      await handler(req, res);
      expect(res.status).not.toHaveBeenCalledWith(400);
    }
  });
});
