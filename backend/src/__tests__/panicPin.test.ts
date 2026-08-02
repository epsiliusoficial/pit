export {}; // scope de módulo

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockCompare = jest.fn();
const mockHash = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      update: (...args: any[]) => mockUserUpdate(...args)
    }
  }
}));
jest.mock('../core/crypto/hash', () => ({
  comparePassword: (...args: any[]) => mockCompare(...args),
  hashPassword: (...args: any[]) => mockHash(...args)
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de PIN de Emergencia / Modo Pánico (nuevo)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset();
    mockCompare.mockReset();
    mockHash.mockReset();
  });

  it('rechaza configurar un PIN de emergencia demasiado corto', async () => {
    const { panicPinRouter } = await import('../modules/auth/panicPin');
    const handler = getHandler(panicPinRouter, 'post', '/');

    const req: any = { userId: 'user1', body: { currentPassword: 'realpass', panicPin: '12' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('rechaza si la contraseña actual está mal', async () => {
    const { panicPinRouter } = await import('../modules/auth/panicPin');
    const handler = getHandler(panicPinRouter, 'post', '/');
    mockUserFindUnique.mockResolvedValue({ id: 'user1', passwordHash: 'hash-real', settings: {} });
    mockCompare.mockResolvedValueOnce(false); // contraseña real incorrecta

    const req: any = { userId: 'user1', body: { currentPassword: 'mal', panicPin: '9999' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('rechaza si el PIN de pánico es igual a la contraseña real', async () => {
    const { panicPinRouter } = await import('../modules/auth/panicPin');
    const handler = getHandler(panicPinRouter, 'post', '/');
    mockUserFindUnique.mockResolvedValue({ id: 'user1', passwordHash: 'hash-real', settings: {} });
    mockCompare.mockResolvedValueOnce(true); // contraseña real ok
    mockCompare.mockResolvedValueOnce(true); // panicPin === passwordHash real

    const req: any = { userId: 'user1', body: { currentPassword: 'realpass', panicPin: 'realpass' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('configura el PIN de pánico guardando el hash, sin pisar otras settings', async () => {
    const { panicPinRouter } = await import('../modules/auth/panicPin');
    const handler = getHandler(panicPinRouter, 'post', '/');
    mockUserFindUnique.mockResolvedValue({ id: 'user1', passwordHash: 'hash-real', settings: { theme: 'dark' } });
    mockCompare.mockResolvedValueOnce(true); // contraseña real ok
    mockCompare.mockResolvedValueOnce(false); // panicPin distinto de la real
    mockHash.mockResolvedValue('hash-panic');

    const req: any = { userId: 'user1', body: { currentPassword: 'realpass', panicPin: '999999' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { settings: { theme: 'dark', panicPinHash: 'hash-panic' } }
    });
    expect(res.json).toHaveBeenCalledWith({ configured: true });
  });

  it('borra el PIN de pánico configurado', async () => {
    const { panicPinRouter } = await import('../modules/auth/panicPin');
    const handler = getHandler(panicPinRouter, 'delete', '/');
    mockUserFindUnique.mockResolvedValue({ id: 'user1', settings: { panicPinHash: 'algo', theme: 'dark' } });

    const req: any = { userId: 'user1' };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: 'user1' }, data: { settings: { theme: 'dark' } } });
    expect(res.json).toHaveBeenCalledWith({ configured: false });
  });
});
