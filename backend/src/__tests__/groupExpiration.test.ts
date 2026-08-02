export {}; // scope de módulo

const mockChatUserFindUnique = jest.fn();
const mockChatUserUpdateMany = jest.fn();
const mockChatFindUnique = jest.fn();
const mockChatFindMany = jest.fn();
const mockChatUpdate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      updateMany: (...args: any[]) => mockChatUserUpdateMany(...args)
    },
    chat: {
      findUnique: (...args: any[]) => mockChatFindUnique(...args),
      findMany: (...args: any[]) => mockChatFindMany(...args),
      update: (...args: any[]) => mockChatUpdate(...args)
    }
  }
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Grupos con Fecha de Vencimiento (nuevo)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockChatUserUpdateMany.mockReset();
    mockChatFindUnique.mockReset();
    mockChatFindMany.mockReset();
    mockChatUpdate.mockReset();
  });

  it('rechaza fijar vencimiento si no sos admin', async () => {
    const { groupExpirationRouter } = await import('../modules/chat/groupExpiration');
    const handler = getHandler(groupExpirationRouter, '/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, body: { expiresAt: new Date(Date.now() + 100000).toISOString() } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rechaza una fecha de vencimiento en el pasado', async () => {
    const { groupExpirationRouter } = await import('../modules/chat/groupExpiration');
    const handler = getHandler(groupExpirationRouter, '/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', isGroup: true, groupConfig: {} });

    const req: any = { userId: 'admin1', params: { chatId: 'chatA' }, body: { expiresAt: new Date(Date.now() - 1000).toISOString() } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('fija la fecha de vencimiento correctamente', async () => {
    const { groupExpirationRouter } = await import('../modules/chat/groupExpiration');
    const handler = getHandler(groupExpirationRouter, '/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', isGroup: true, groupConfig: { pinnedMessages: ['m1'] } });
    const future = new Date(Date.now() + 100000).toISOString();

    const req: any = { userId: 'admin1', params: { chatId: 'chatA' }, body: { expiresAt: future } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUpdate).toHaveBeenCalledWith({
      where: { id: 'chatA' },
      data: { groupConfig: { pinnedMessages: ['m1'], expiresAt: future } }
    });
  });

  it('cancela el vencimiento cuando se manda expiresAt: null', async () => {
    const { groupExpirationRouter } = await import('../modules/chat/groupExpiration');
    const handler = getHandler(groupExpirationRouter, '/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', isGroup: true, groupConfig: { expiresAt: 'algo' } });

    const req: any = { userId: 'admin1', params: { chatId: 'chatA' }, body: { expiresAt: null } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUpdate).toHaveBeenCalledWith({ where: { id: 'chatA' }, data: { groupConfig: {} } });
    expect(res.json).toHaveBeenCalledWith({ expiresAt: null });
  });

  it('el worker no toca grupos que todavía no vencieron', async () => {
    const { archiveExpiredGroups } = await import('../modules/chat/groupExpiration');
    mockChatFindMany.mockResolvedValue([
      { id: 'chatA', groupConfig: { expiresAt: new Date(Date.now() + 100000).toISOString() } }
    ]);

    await archiveExpiredGroups();

    expect(mockChatUserUpdateMany).not.toHaveBeenCalled();
  });

  it('el worker archiva para todos los miembros un grupo ya vencido', async () => {
    const { archiveExpiredGroups } = await import('../modules/chat/groupExpiration');
    mockChatFindMany.mockResolvedValue([
      { id: 'chatA', groupConfig: { expiresAt: new Date(Date.now() - 1000).toISOString() } }
    ]);

    await archiveExpiredGroups();

    expect(mockChatUserUpdateMany).toHaveBeenCalledWith({ where: { chatId: 'chatA' }, data: { isArchived: true } });
    expect(mockChatUpdate).toHaveBeenCalledWith({
      where: { id: 'chatA' },
      data: { groupConfig: { archivedByExpiration: true } }
    });
  });
});
