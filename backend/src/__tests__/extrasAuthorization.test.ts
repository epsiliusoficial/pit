export {}; // fuerza scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockChatUserFindUnique = jest.fn();
const mockMessageFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    message: { findUnique: (...args: any[]) => mockMessageFindUnique(...args), findMany: jest.fn(), update: jest.fn() },
    scheduledMessage: { create: jest.fn() }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Extras — bugs de autorización corregidos (fuga de información)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockMessageFindUnique.mockReset();
  });

  it('rechaza destacar un mensaje de un chat al que no pertenece', async () => {
    const { extrasRouter } = await import('../modules/chat/extras');
    const handler = getHandler(extrasRouter, 'post', '/star/:id');

    mockMessageFindUnique.mockResolvedValue({ id: 'msg1', chatId: 'chat-ajeno', isStarred: null });
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'atacante', params: { id: 'msg1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rechaza listar destacados de un chat ajeno (fuga de información real corregida)', async () => {
    const { extrasRouter } = await import('../modules/chat/extras');
    const handler = getHandler(extrasRouter, 'get', '/starred/:chatId');

    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'atacante', params: { chatId: 'chat-ajeno' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rechaza programar un mensaje en un chat al que no pertenece', async () => {
    const { extrasRouter } = await import('../modules/chat/extras');
    const handler = getHandler(extrasRouter, 'post', '/schedule');

    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = {
      userId: 'atacante',
      body: { chatId: 'chat-ajeno', content: 'spam', sendAt: new Date().toISOString() }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
