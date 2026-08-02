export {}; // scope de módulo

const mockChatFindUnique = jest.fn();
const mockChatUpdate = jest.fn();
const mockChatUserFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chat: {
      findUnique: (...args: any[]) => mockChatFindUnique(...args),
      update: (...args: any[]) => mockChatUpdate(...args)
    },
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Roles Personalizados de Grupo (nuevo, MODERATOR)', () => {
  beforeEach(() => {
    mockChatFindUnique.mockReset();
    mockChatUpdate.mockReset();
    mockChatUserFindUnique.mockReset();
  });

  it('rechaza asignar roles si no sos admin del grupo', async () => {
    const { customRolesRouter } = await import('../modules/chat/customRoles');
    const handler = getHandler(customRolesRouter, 'post', '/:chatId/:userId');
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', isGroup: true, groupConfig: {} });
    mockChatUserFindUnique.mockResolvedValueOnce({ role: 'MEMBER' }); // quien pide, no es admin

    const req: any = { userId: 'user1', params: { chatId: 'chatA', userId: 'user2' }, body: { role: 'MODERATOR' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it('rechaza si el chat no es un grupo', async () => {
    const { customRolesRouter } = await import('../modules/chat/customRoles');
    const handler = getHandler(customRolesRouter, 'post', '/:chatId/:userId');
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', isGroup: false });

    const req: any = { userId: 'user1', params: { chatId: 'chatA', userId: 'user2' }, body: { role: 'MODERATOR' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza asignar MODERATOR a alguien que ya es ADMIN', async () => {
    const { customRolesRouter } = await import('../modules/chat/customRoles');
    const handler = getHandler(customRolesRouter, 'post', '/:chatId/:userId');
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', isGroup: true, groupConfig: {} });
    mockChatUserFindUnique
      .mockResolvedValueOnce({ role: 'ADMIN' }) // quien pide
      .mockResolvedValueOnce({ role: 'ADMIN' }); // el target ya es admin

    const req: any = { userId: 'user1', params: { chatId: 'chatA', userId: 'user2' }, body: { role: 'MODERATOR' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('asigna MODERATOR correctamente, guardando en groupConfig sin pisar lo existente', async () => {
    const { customRolesRouter } = await import('../modules/chat/customRoles');
    const handler = getHandler(customRolesRouter, 'post', '/:chatId/:userId');
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', isGroup: true, groupConfig: { pinnedMessages: ['m1'] } });
    mockChatUserFindUnique
      .mockResolvedValueOnce({ role: 'ADMIN' })
      .mockResolvedValueOnce({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { chatId: 'chatA', userId: 'user2' }, body: { role: 'MODERATOR' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUpdate).toHaveBeenCalledWith({
      where: { id: 'chatA' },
      data: { groupConfig: { pinnedMessages: ['m1'], customRoles: { user2: 'MODERATOR' } } }
    });
    expect(res.json).toHaveBeenCalledWith({ userId: 'user2', role: 'MODERATOR' });
  });

  it('saca el rol de moderador cuando se manda sin role', async () => {
    const { customRolesRouter } = await import('../modules/chat/customRoles');
    const handler = getHandler(customRolesRouter, 'post', '/:chatId/:userId');
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', isGroup: true, groupConfig: { customRoles: { user2: 'MODERATOR' } } });
    mockChatUserFindUnique
      .mockResolvedValueOnce({ role: 'ADMIN' })
      .mockResolvedValueOnce({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { chatId: 'chatA', userId: 'user2' }, body: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUpdate).toHaveBeenCalledWith({ where: { id: 'chatA' }, data: { groupConfig: { customRoles: {} } } });
    expect(res.json).toHaveBeenCalledWith({ userId: 'user2', role: null });
  });

  it('isModerator devuelve true solo si el userId figura como MODERATOR', async () => {
    const { isModerator } = await import('../modules/chat/customRoles');
    mockChatFindUnique.mockResolvedValue({ groupConfig: { customRoles: { user2: 'MODERATOR' } } });

    expect(await isModerator('chatA', 'user2')).toBe(true);
    expect(await isModerator('chatA', 'user3')).toBe(false);
  });
});
