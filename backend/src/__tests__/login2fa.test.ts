export {}; // fuerza scope de módulo

const mockUserFindUnique = jest.fn();
const mockDeviceCreate = jest.fn();
const mockCompare = jest.fn();
const mockVerifyOtp = jest.fn();
const mockTotpSettingsOf = jest.fn();
const mockVerifyLoginTotp = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) },
    device: { create: (...args: any[]) => mockDeviceCreate(...args) }
  }
}));
jest.mock('../core/crypto/hash', () => ({
  comparePassword: (...args: any[]) => mockCompare(...args),
  hashPassword: jest.fn()
}));
jest.mock('../core/crypto/kyber', () => ({ generateKeyPair: jest.fn() }));
jest.mock('../modules/auth/otp.service', () => ({
  generateOtp: jest.fn(),
  storeOtp: jest.fn(),
  verifyOtp: (...args: any[]) => mockVerifyOtp(...args)
}));
jest.mock('../core/audit/auditLog', () => ({ auditLog: jest.fn() }));
jest.mock('../core/utils/jwtSecret', () => ({ getJwtSecret: () => 'test-secret' }));
jest.mock('../modules/auth/twoFactor', () => ({
  totpSettingsOf: (...args: any[]) => mockTotpSettingsOf(...args),
  verifyLoginTotp: (...args: any[]) => mockVerifyLoginTotp(...args)
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Login con 2FA — la contraseña sola ya no alcanza si el usuario activó TOTP', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockDeviceCreate.mockReset();
    mockCompare.mockReset();
    mockVerifyOtp.mockReset();
    mockTotpSettingsOf.mockReset();
    mockVerifyLoginTotp.mockReset();

    mockVerifyOtp.mockResolvedValue(true);
    mockCompare.mockResolvedValue(true); // password correcta
    mockDeviceCreate.mockResolvedValue({ id: 'device-1' });
  });

  it('rechaza el login si el usuario tiene 2FA activado y no manda totpCode', async () => {
    const { authRouter } = await import('../modules/auth/controller');
    const handler = getHandler(authRouter, '/otp/verify');

    mockUserFindUnique.mockResolvedValue({ id: 'user-1', phone: '+54911', passwordHash: 'hash', settings: {} });
    mockTotpSettingsOf.mockReturnValue({ secret: 'ABC', enabled: true });

    const req: any = { body: { phone: '+54911', otp: '123456', password: 'pw' }, headers: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requires2fa: true }));
    expect(mockDeviceCreate).not.toHaveBeenCalled();
  });

  it('rechaza el login si el código 2FA es inválido', async () => {
    const { authRouter } = await import('../modules/auth/controller');
    const handler = getHandler(authRouter, '/otp/verify');

    mockUserFindUnique.mockResolvedValue({ id: 'user-1', phone: '+54911', passwordHash: 'hash', settings: {} });
    mockTotpSettingsOf.mockReturnValue({ secret: 'ABC', enabled: true });
    mockVerifyLoginTotp.mockResolvedValue(false);

    const req: any = { body: { phone: '+54911', otp: '123456', password: 'pw', totpCode: '000000' }, headers: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockDeviceCreate).not.toHaveBeenCalled();
  });

  it('permite el login con un totpCode válido', async () => {
    const { authRouter } = await import('../modules/auth/controller');
    const handler = getHandler(authRouter, '/otp/verify');

    mockUserFindUnique.mockResolvedValue({ id: 'user-1', phone: '+54911', passwordHash: 'hash', settings: {} });
    mockTotpSettingsOf.mockReturnValue({ secret: 'ABC', enabled: true });
    mockVerifyLoginTotp.mockResolvedValue(true);

    const req: any = { body: { phone: '+54911', otp: '123456', password: 'pw', totpCode: '123456' }, headers: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockDeviceCreate).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(401);
  });

  it('no pide 2FA si el usuario nunca lo activó (comportamiento sin cambios)', async () => {
    const { authRouter } = await import('../modules/auth/controller');
    const handler = getHandler(authRouter, '/otp/verify');

    mockUserFindUnique.mockResolvedValue({ id: 'user-1', phone: '+54911', passwordHash: 'hash', settings: {} });
    mockTotpSettingsOf.mockReturnValue(undefined);

    const req: any = { body: { phone: '+54911', otp: '123456', password: 'pw' }, headers: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockDeviceCreate).toHaveBeenCalled();
  });
});
