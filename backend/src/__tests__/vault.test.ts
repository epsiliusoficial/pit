export {}; // scope de módulo

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockHash = jest.fn();
const mockCompare = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      update: (...args: any[]) => mockUserUpdate(...args)
    },
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) }
  }
}));
jest.mock('../core/crypto/hash', () => ({
  hashPassword: (...args: any[]) => mockHash(...args),
  comparePassword: (...args: any[]) => mockCompare(...args)
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Bóveda de Chats (nuevo)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset();
    mockChatUserFindUnique.mockReset();
    mockHash.mockReset();
    mockCompare.mockReset();
  });

  it('rechaza configurar un PIN de bóveda demasiado corto', async () => {
    const { vaultRouter } = await import('../modules/auth/vault');
    const handler = getHandler(vaultRouter, 'post', '/setup');

    const req: any = { userId: 'user1', body: { pin: '1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('configura el PIN sin perder chats ya escondidos previamente', async () => {
    const { vaultRouter } = await import('../modules/auth/vault');
    const handler = getHandler(vaultRouter, 'post', '/setup');
    mockUserFindUnique.mockResolvedValue({ settings: { vault: { pinHash: 'viejo', hiddenChatIds: ['chatA'] } } });
    mockHash.mockResolvedValue('hash-nuevo');

    const req: any = { userId: 'user1', body: { pin: '1234' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { settings: { vault: { pinHash: 'hash-nuevo', hiddenChatIds: ['chatA'] } } }
    });
  });

  it('rechaza esconder un chat si no sos miembro', async () => {
    const { vaultRouter } = await import('../modules/auth/vault');
    const handler = getHandler(vaultRouter, 'post', '/hide/:chatId');
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rechaza esconder un chat si todavía no configuraste la bóveda', async () => {
    const { vaultRouter } = await import('../modules/auth/vault');
    const handler = getHandler(vaultRouter, 'post', '/hide/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockUserFindUnique.mockResolvedValue({ settings: {} });

    const req: any = { userId: 'user1', params: { chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('esconde un chat sin duplicarlo si ya estaba escondido', async () => {
    const { vaultRouter } = await import('../modules/auth/vault');
    const handler = getHandler(vaultRouter, 'post', '/hide/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockUserFindUnique.mockResolvedValue({ settings: { vault: { pinHash: 'hash', hiddenChatIds: ['chatA'] } } });

    const req: any = { userId: 'user1', params: { chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ hiddenChatIds: ['chatA'] });
  });

  it('rechaza desbloquear la bóveda con un PIN incorrecto', async () => {
    const { vaultRouter } = await import('../modules/auth/vault');
    const handler = getHandler(vaultRouter, 'post', '/unlock');
    mockUserFindUnique.mockResolvedValue({ settings: { vault: { pinHash: 'hash', hiddenChatIds: ['chatA'] } } });
    mockCompare.mockResolvedValue(false);

    const req: any = { userId: 'user1', body: { pin: 'mal' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('desbloquea la bóveda y devuelve los chats ocultos con el PIN correcto', async () => {
    const { vaultRouter } = await import('../modules/auth/vault');
    const handler = getHandler(vaultRouter, 'post', '/unlock');
    mockUserFindUnique.mockResolvedValue({ settings: { vault: { pinHash: 'hash', hiddenChatIds: ['chatA', 'chatB'] } } });
    mockCompare.mockResolvedValue(true);

    const req: any = { userId: 'user1', body: { pin: 'bien' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ hiddenChatIds: ['chatA', 'chatB'] });
  });

  it('status no expone los ids escondidos, solo si hay bóveda configurada', async () => {
    const { vaultRouter } = await import('../modules/auth/vault');
    const handler = getHandler(vaultRouter, 'get', '/status');
    mockUserFindUnique.mockResolvedValue({ settings: { vault: { pinHash: 'hash', hiddenChatIds: ['chatA', 'chatB'] } } });

    const req: any = { userId: 'user1' };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ configured: true, hiddenCount: 2 });
  });
});
