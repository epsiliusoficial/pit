export {}; // scope de módulo

const mockChatUserFindUnique = jest.fn();
const mockChatUserCreate = jest.fn();
const mockChatFindUnique = jest.fn();
const mockChatUpdate = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      create: (...args: any[]) => mockChatUserCreate(...args)
    },
    chat: {
      findUnique: (...args: any[]) => mockChatFindUnique(...args),
      update: (...args: any[]) => mockChatUpdate(...args)
    },
    $transaction: (...args: any[]) => mockTransaction(...args)
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Solicitud de Unión con Aprobación (nuevo)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockChatUserCreate.mockReset();
    mockChatFindUnique.mockReset();
    mockChatUpdate.mockReset();
    mockTransaction.mockReset();
    mockTransaction.mockResolvedValue([]);
  });

  it('rechaza activar la aprobación si no sos admin', async () => {
    const { joinRequestsRouter } = await import('../modules/chat/joinRequests');
    const handler = getHandler(joinRequestsRouter, 'post', '/:chatId/toggle');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, body: { requireApproval: true } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it('activa la aprobación correctamente sin pisar otra config del grupo', async () => {
    const { joinRequestsRouter } = await import('../modules/chat/joinRequests');
    const handler = getHandler(joinRequestsRouter, 'post', '/:chatId/toggle');
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', isGroup: true, groupConfig: { pinnedMessages: ['m1'] } });

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, body: { requireApproval: true } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUpdate).toHaveBeenCalledWith({
      where: { id: 'chatA' },
      data: { groupConfig: { pinnedMessages: ['m1'], requireApproval: true } }
    });
  });

  it('rechaza ver la lista de espera si no sos admin', async () => {
    const { joinRequestsRouter } = await import('../modules/chat/joinRequests');
    const handler = getHandler(joinRequestsRouter, 'get', '/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('devuelve 404 al aprobar a alguien que no tiene solicitud pendiente', async () => {
    const { joinRequestsRouter } = await import('../modules/chat/joinRequests');
    const handler = getHandler(joinRequestsRouter, 'post', '/:chatId/:userId/approve');
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockChatFindUnique.mockResolvedValue({ groupConfig: { joinRequests: [] } });

    const req: any = { userId: 'admin1', params: { chatId: 'chatA', userId: 'user2' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('aprueba a alguien pendiente: lo suma como miembro y lo saca de la cola en una transacción', async () => {
    const { joinRequestsRouter } = await import('../modules/chat/joinRequests');
    const handler = getHandler(joinRequestsRouter, 'post', '/:chatId/:userId/approve');
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockChatFindUnique.mockResolvedValue({ groupConfig: { joinRequests: [{ userId: 'user2', requestedAt: 'x' }] } });

    const req: any = { userId: 'admin1', params: { chatId: 'chatA', userId: 'user2' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockTransaction).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ approved: true, userId: 'user2' });
  });

  it('rechaza (sin unir) a alguien de la cola de espera', async () => {
    const { joinRequestsRouter } = await import('../modules/chat/joinRequests');
    const handler = getHandler(joinRequestsRouter, 'post', '/:chatId/:userId/reject');
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockChatFindUnique.mockResolvedValue({ groupConfig: { joinRequests: [{ userId: 'user2', requestedAt: 'x' }] } });

    const req: any = { userId: 'admin1', params: { chatId: 'chatA', userId: 'user2' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUpdate).toHaveBeenCalledWith({ where: { id: 'chatA' }, data: { groupConfig: { joinRequests: [] } } });
    expect(mockChatUserCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ rejected: true, userId: 'user2' });
  });
});
