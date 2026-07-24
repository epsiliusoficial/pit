export {}; // fuerza scope de módulo

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockDeviceDeleteMany = jest.fn();
const mockCompare = jest.fn();
const mockHash = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      update: (...args: any[]) => mockUserUpdate(...args)
    },
    device: { deleteMany: (...args: any[]) => mockDeviceDeleteMany(...args) }
  }
}));

jest.mock('../core/crypto/hash', () => ({
  comparePassword: (...args: any[]) => mockCompare(...args),
  hashPassword: (...args: any[]) => mockHash(...args)
}));

jest.mock('../core/audit/auditLog', () => ({ auditLog: jest.fn() }));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Cambio de Contraseña (nuevo, faltaba)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset();
    mockDeviceDeleteMany.mockReset();
    mockCompare.mockReset();
    mockHash.mockReset();
  });

  it('rechaza si la contraseña actual es incorrecta', async () => {
    const { authRouter } = await import('../modules/auth/controller');
    const handler = getHandler(authRouter, '/change-password');

    mockUserFindUnique.mockResolvedValue({ id: 'user1', passwordHash: 'hash-viejo' });
    mockCompare.mockResolvedValue(false);

    const req: any = { userId: 'user1', deviceId: 'device1', body: { currentPassword: 'mal', newPassword: 'nueva1234' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('cambia la contraseña y revoca las OTRAS sesiones, preservando la actual', async () => {
    const { authRouter } = await import('../modules/auth/controller');
    const handler = getHandler(authRouter, '/change-password');

    mockUserFindUnique.mockResolvedValue({ id: 'user1', passwordHash: 'hash-viejo' });
    mockCompare.mockResolvedValue(true);
    mockHash.mockResolvedValue('hash-nuevo');
    mockUserUpdate.mockResolvedValue({});
    mockDeviceDeleteMany.mockResolvedValue({ count: 2 });

    const req: any = { userId: 'user1', deviceId: 'device-actual', body: { currentPassword: 'buena', newPassword: 'nueva1234' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: 'user1' }, data: { passwordHash: 'hash-nuevo' } });
    expect(mockDeviceDeleteMany).toHaveBeenCalledWith({
      where: { userId: 'user1', id: { not: 'device-actual' } }
    });
    expect(res.json).toHaveBeenCalledWith({ changed: true });
  });
});
