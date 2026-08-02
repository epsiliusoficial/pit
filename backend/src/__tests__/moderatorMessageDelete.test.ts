export {}; // scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockMessageFindUnique = jest.fn();
const mockMessageUpdate = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockChatFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    message: {
      findUnique: (...args: any[]) => mockMessageFindUnique(...args),
      update: (...args: any[]) => mockMessageUpdate(...args)
    },
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    chat: { findUnique: (...args: any[]) => mockChatFindUnique(...args) }
  }
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Borrado de mensajes por ADMIN/MODERATOR (limitación real corregida)', () => {
  beforeEach(() => {
    mockMessageFindUnique.mockReset();
    mockMessageUpdate.mockReset();
    mockChatUserFindUnique.mockReset();
    mockChatFindUnique.mockReset();
  });

  it('el dueño del mensaje lo puede borrar como siempre', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/message/:id');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', senderId: 'user1', chatId: 'chatA' });

    const req: any = { userId: 'user1', params: { id: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockMessageUpdate).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ deleted: true });
  });

  it('un miembro común NO puede borrar un mensaje ajeno', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/message/:id');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', senderId: 'userX', chatId: 'chatA' });
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatFindUnique.mockResolvedValue({ groupConfig: {} });

    const req: any = { userId: 'user1', params: { id: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockMessageUpdate).not.toHaveBeenCalled();
  });

  it('un ADMIN del grupo SÍ puede borrar un mensaje ajeno (antes no se podía)', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/message/:id');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', senderId: 'userX', chatId: 'chatA' });
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockChatFindUnique.mockResolvedValue({ groupConfig: {} });

    const req: any = { userId: 'user1', params: { id: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockMessageUpdate).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ deleted: true });
  });

  it('un MODERATOR (rol personalizado) puede borrar un mensaje ajeno', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/message/:id');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', senderId: 'userX', chatId: 'chatA' });
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatFindUnique.mockResolvedValue({ groupConfig: { customRoles: { user1: 'MODERATOR' } } });

    const req: any = { userId: 'user1', params: { id: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockMessageUpdate).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ deleted: true });
  });

  it('devuelve 404 si el mensaje no existe', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/message/:id');
    mockMessageFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { id: 'nope' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
