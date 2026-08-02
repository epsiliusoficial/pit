export {}; // fuerza scope de módulo

const mockChatUserFindUnique = jest.fn();
const mockChatUserUpdate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      update: (...args: any[]) => mockChatUserUpdate(...args)
    }
  }
}));

jest.mock('../core/audit/auditLog', () => ({ auditLog: jest.fn() }));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Moderación — validación de rol corregida (bug real encontrado)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockChatUserUpdate.mockReset();
  });

  it('rechaza un rol que no está en el enum permitido', async () => {
    const { moderationRouter } = await import('../modules/chat/moderation');
    const handler = getHandler(moderationRouter, '/group/:chatId/role/:userId');

    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' }); // el que llama SÍ es admin

    const req: any = {
      userId: 'admin1',
      params: { chatId: 'chat1', userId: 'victima' },
      body: { role: 'SUPREME_LEADER' } // valor arbitrario, no es un rol válido
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockChatUserUpdate).not.toHaveBeenCalled();
  });

  it('acepta un rol válido del enum', async () => {
    const { moderationRouter } = await import('../modules/chat/moderation');
    const handler = getHandler(moderationRouter, '/group/:chatId/role/:userId');

    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockChatUserUpdate.mockResolvedValue({});

    const req: any = {
      userId: 'admin1',
      params: { chatId: 'chat1', userId: 'user2' },
      body: { role: 'MOD' }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUserUpdate).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ role: 'MOD' });
  });
});
