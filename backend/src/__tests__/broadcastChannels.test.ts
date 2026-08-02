export {}; // fuerza scope de módulo

const mockChatCreate = jest.fn();
const mockChatFindUnique = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockChatUserCreate = jest.fn();
const mockChatUserDelete = jest.fn();
const mockChatUserCount = jest.fn();
const mockChatUserFindMany = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chat: {
      create: (...args: any[]) => mockChatCreate(...args),
      findUnique: (...args: any[]) => mockChatFindUnique(...args)
    },
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      create: (...args: any[]) => mockChatUserCreate(...args),
      delete: (...args: any[]) => mockChatUserDelete(...args),
      count: (...args: any[]) => mockChatUserCount(...args),
      findMany: (...args: any[]) => mockChatUserFindMany(...args)
    }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Canales de Difusión — sistema nuevo (uno a muchos, privacidad de oyentes)', () => {
  beforeEach(() => {
    mockChatCreate.mockReset();
    mockChatFindUnique.mockReset();
    mockChatUserFindUnique.mockReset();
    mockChatUserCreate.mockReset();
    mockChatUserDelete.mockReset();
    mockChatUserCount.mockReset();
    mockChatUserFindMany.mockReset();
  });

  it('crea el canal marcando groupConfig.broadcast=true y al creador como ADMIN', async () => {
    const { broadcastRouter } = await import('../modules/chat/broadcastChannels');
    const handler = getHandler(broadcastRouter, 'post', '/create');
    mockChatCreate.mockResolvedValue({ id: 'chatX', name: 'Anuncios' });

    const req: any = { userId: 'creador', body: { name: 'Anuncios' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          groupConfig: { broadcast: true },
          users: { create: [{ userId: 'creador', role: 'ADMIN' }] }
        })
      })
    );
  });

  it('permite a cualquier usuario autenticado unirse (canal público) de forma idempotente', async () => {
    const { broadcastRouter } = await import('../modules/chat/broadcastChannels');
    const handler = getHandler(broadcastRouter, 'post', '/:chatId/join');
    mockChatFindUnique.mockResolvedValue({ groupConfig: { broadcast: true } });
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'oyente1', params: { chatId: 'chatX' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: 'oyente1', chatId: 'chatX', role: 'MEMBER' } })
    );
    expect(res.json).toHaveBeenCalledWith({ joined: true, alreadyMember: false });
  });

  it('rechaza unirse a un chat que no es un canal de difusión real', async () => {
    const { broadcastRouter } = await import('../modules/chat/broadcastChannels');
    const handler = getHandler(broadcastRouter, 'post', '/:chatId/join');
    mockChatFindUnique.mockResolvedValue({ groupConfig: null });

    const req: any = { userId: 'user1', params: { chatId: 'grupoNormal' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockChatUserCreate).not.toHaveBeenCalled();
  });

  it('un oyente común (no admin) NUNCA recibe la lista de otros suscriptores, solo el conteo', async () => {
    const { broadcastRouter } = await import('../modules/chat/broadcastChannels');
    const handler = getHandler(broadcastRouter, 'get', '/:chatId/info');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatFindUnique.mockResolvedValue({ name: 'Anuncios', groupConfig: { broadcast: true } });
    mockChatUserCount.mockResolvedValue(5000);

    const req: any = { userId: 'oyente1', params: { chatId: 'chatX' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUserFindMany).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.followerCount).toBe(5000);
    expect(payload.followers).toBeUndefined();
    expect(payload.isAdmin).toBe(false);
  });

  it('el admin del canal SÍ puede ver la lista completa de suscriptores', async () => {
    const { broadcastRouter } = await import('../modules/chat/broadcastChannels');
    const handler = getHandler(broadcastRouter, 'get', '/:chatId/info');
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockChatFindUnique.mockResolvedValue({ name: 'Anuncios', groupConfig: { broadcast: true } });
    mockChatUserCount.mockResolvedValue(2);
    mockChatUserFindMany.mockResolvedValue([{ userId: 'a', role: 'ADMIN' }, { userId: 'b', role: 'MEMBER' }]);

    const req: any = { userId: 'admin1', params: { chatId: 'chatX' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.followers).toHaveLength(2);
  });

  it('el administrador no puede abandonar su propio canal (tiene que borrarlo)', async () => {
    const { broadcastRouter } = await import('../modules/chat/broadcastChannels');
    const handler = getHandler(broadcastRouter, 'post', '/:chatId/leave');
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });

    const req: any = { userId: 'admin1', params: { chatId: 'chatX' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockChatUserDelete).not.toHaveBeenCalled();
  });
});
