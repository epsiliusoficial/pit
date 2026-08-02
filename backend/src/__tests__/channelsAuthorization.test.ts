export {}; // fuerza scope de módulo

const mockChatUserFindUnique = jest.fn();
const mockChannelCreate = jest.fn();
const mockChannelFindMany = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    channel: {
      create: (...args: any[]) => mockChannelCreate(...args),
      findMany: (...args: any[]) => mockChannelFindMany(...args)
    }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Canales — bugs corregidos (autorización y validación de tipo)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockChannelCreate.mockReset();
    mockChannelFindMany.mockReset();
  });

  it('rechaza listar canales de un grupo al que no pertenece (bug real corregido)', async () => {
    const { channelRouter } = await import('../modules/chat/channels');
    const handler = getHandler(channelRouter, 'get', '/:chatId');
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'atacante', params: { chatId: 'chat-ajeno' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockChannelFindMany).not.toHaveBeenCalled();
  });

  it('rechaza un name que no es string, sin lanzar excepción (bug real corregido)', async () => {
    const { channelRouter } = await import('../modules/chat/channels');
    const handler = getHandler(channelRouter, 'post', '/:chatId/create');

    const req: any = { userId: 'user1', params: { chatId: 'chat1' }, body: { name: { a: 1 } } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await expect(handler(req, res)).resolves.not.toThrow();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
