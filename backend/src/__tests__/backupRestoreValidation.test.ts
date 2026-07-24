export {}; // scope de módulo propio

const mockUserUpdate = jest.fn();
const mockContactUpsert = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: (...args: any[]) => mockUserUpdate(...args)
    },
    chatUser: { findMany: jest.fn() },
    message: { findMany: jest.fn() },
    contact: {
      findMany: jest.fn(),
      upsert: (...args: any[]) => mockContactUpsert(...args)
    },
    achievement: { findMany: jest.fn() },
    userStreak: { findUnique: jest.fn() }
  }
}));
jest.mock('../core/crypto/messageEncryption', () => ({ decryptContent: (c: string) => c }));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('POST /api/backup/restore-profile — validación agregada (bug corregido)', () => {
  beforeEach(() => {
    mockUserUpdate.mockReset();
    mockContactUpsert.mockReset();
    mockUserUpdate.mockResolvedValue({ id: 'user-1', name: 'Mateo' });
  });

  it('rechaza un avatarUrl con protocolo peligroso dentro del backup', async () => {
    const { backupRouter } = await import('../modules/backup/controller');
    const handler = getHandler(backupRouter, 'post', '/restore-profile');

    const req: any = { userId: 'user-1', body: { backup: { profile: { avatarUrl: 'javascript:alert(1)' } } } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('rechaza un backup con demasiados contactos', async () => {
    const { backupRouter } = await import('../modules/backup/controller');
    const handler = getHandler(backupRouter, 'post', '/restore-profile');

    const hugeContactList = Array.from({ length: 2001 }, (_, i) => ({ contactId: `c${i}` }));
    const req: any = { userId: 'user-1', body: { backup: { profile: {}, contacts: hugeContactList } } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('acepta un backup válido y restaura perfil + contactos', async () => {
    const { backupRouter } = await import('../modules/backup/controller');
    const handler = getHandler(backupRouter, 'post', '/restore-profile');
    mockContactUpsert.mockResolvedValue({});

    const req: any = {
      userId: 'user-1',
      body: { backup: { profile: { bio: 'Hola' }, contacts: [{ contactId: 'c1', alias: 'Amigo' }] } }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalled();
    expect(mockContactUpsert).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ restored: true }));
  });
});
