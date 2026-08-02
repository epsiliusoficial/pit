export {}; // scope de módulo propio

const mockChatUserFindUnique = jest.fn();
const mockChatUserFindMany = jest.fn();
const mockChatUserUpdate = jest.fn();
const mockChatUserDelete = jest.fn();
const mockAuditLog = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      findMany: (...args: any[]) => mockChatUserFindMany(...args),
      update: (...args: any[]) => mockChatUserUpdate(...args),
      delete: (...args: any[]) => mockChatUserDelete(...args)
    }
  }
}));
jest.mock('../core/audit/auditLog', () => ({ auditLog: (...args: any[]) => mockAuditLog(...args) }));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Salir del grupo (sistema nuevo — antes no existía ninguna forma de dejar un grupo)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockChatUserFindMany.mockReset();
    mockChatUserUpdate.mockReset();
    mockChatUserDelete.mockReset();
    mockAuditLog.mockReset();
    mockChatUserDelete.mockResolvedValue({});
    mockChatUserUpdate.mockResolvedValue({});
  });

  it('rechaza salir de un chat al que no pertenecés', async () => {
    mockChatUserFindUnique.mockResolvedValue(null);
    const { moderationRouter } = await import('../modules/chat/moderation');
    const handler = getHandler(moderationRouter, '/group/:chatId/leave');

    const req: any = { userId: 'user1', params: { chatId: 'chat1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockChatUserDelete).not.toHaveBeenCalled();
  });

  it('un miembro común se va sin que se promueva a nadie', async () => {
    mockChatUserFindUnique.mockResolvedValue({ userId: 'user1', chatId: 'chat1', role: 'MEMBER' });
    const { moderationRouter } = await import('../modules/chat/moderation');
    const handler = getHandler(moderationRouter, '/group/:chatId/leave');

    const req: any = { userId: 'user1', params: { chatId: 'chat1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUserUpdate).not.toHaveBeenCalled();
    expect(mockChatUserDelete).toHaveBeenCalledWith({ where: { userId_chatId: { userId: 'user1', chatId: 'chat1' } } });
    expect(res.json).toHaveBeenCalledWith({ left: true });
  });

  it('si es admin pero hay otro admin, se va sin promover a nadie', async () => {
    mockChatUserFindUnique.mockResolvedValue({ userId: 'user1', chatId: 'chat1', role: 'ADMIN' });
    mockChatUserFindMany.mockResolvedValue([{ userId: 'user2', chatId: 'chat1', role: 'ADMIN' }]);
    const { moderationRouter } = await import('../modules/chat/moderation');
    const handler = getHandler(moderationRouter, '/group/:chatId/leave');

    const req: any = { userId: 'user1', params: { chatId: 'chat1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUserUpdate).not.toHaveBeenCalled();
    expect(mockChatUserDelete).toHaveBeenCalled();
  });

  it('bug real corregido: si es el ÚNICO admin, promueve a otro miembro antes de irse (nunca deja el grupo sin admin)', async () => {
    mockChatUserFindUnique.mockResolvedValue({ userId: 'user1', chatId: 'chat1', role: 'ADMIN' });
    mockChatUserFindMany.mockResolvedValue([
      { userId: 'user2', chatId: 'chat1', role: 'MEMBER' },
      { userId: 'user3', chatId: 'chat1', role: 'MOD' }
    ]);
    const { moderationRouter } = await import('../modules/chat/moderation');
    const handler = getHandler(moderationRouter, '/group/:chatId/leave');

    const req: any = { userId: 'user1', params: { chatId: 'chat1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    // Prefiere promover a quien ya era MOD antes que a un MEMBER común.
    expect(mockChatUserUpdate).toHaveBeenCalledWith({
      where: { userId_chatId: { userId: 'user3', chatId: 'chat1' } },
      data: { role: 'ADMIN' }
    });
    expect(mockChatUserDelete).toHaveBeenCalled();
  });

  it('si es el único admin y el único miembro, simplemente se va (el grupo queda vacío)', async () => {
    mockChatUserFindUnique.mockResolvedValue({ userId: 'user1', chatId: 'chat1', role: 'ADMIN' });
    mockChatUserFindMany.mockResolvedValue([]);
    const { moderationRouter } = await import('../modules/chat/moderation');
    const handler = getHandler(moderationRouter, '/group/:chatId/leave');

    const req: any = { userId: 'user1', params: { chatId: 'chat1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUserUpdate).not.toHaveBeenCalled();
    expect(mockChatUserDelete).toHaveBeenCalled();
  });
});
