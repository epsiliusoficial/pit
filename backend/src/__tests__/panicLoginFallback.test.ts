export {}; // scope de módulo

const mockUserFindUnique = jest.fn();
const mockDeviceCreate = jest.fn();
const mockChatUserUpdateMany = jest.fn();
const mockCompare = jest.fn();
const mockVerifyOtp = jest.fn();
const mockTotpSettingsOf = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) },
    device: { create: (...args: any[]) => mockDeviceCreate(...args) },
    chatUser: { updateMany: (...args: any[]) => mockChatUserUpdateMany(...args) }
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
  verifyLoginTotp: jest.fn()
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Login con PIN de Emergencia (fallback de Modo Pánico)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockDeviceCreate.mockReset();
    mockChatUserUpdateMany.mockReset();
    mockCompare.mockReset();
    mockVerifyOtp.mockReset();
    mockTotpSettingsOf.mockReset();

    mockVerifyOtp.mockResolvedValue(true);
    mockDeviceCreate.mockResolvedValue({ id: 'device-1' });
    mockTotpSettingsOf.mockReturnValue(undefined);
  });

  it('rechaza el login si ni la contraseña real ni el PIN de pánico matchean', async () => {
    const { authRouter } = await import('../modules/auth/controller');
    const handler = getHandler(authRouter, '/otp/verify');
    mockUserFindUnique.mockResolvedValue({ id: 'user-1', phone: '+54911', passwordHash: 'hash', settings: {} });
    mockCompare.mockResolvedValue(false); // ni contraseña real ni pánico matchean

    const req: any = { body: { phone: '+54911', otp: '123456', password: 'nada' }, headers: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockChatUserUpdateMany).not.toHaveBeenCalled();
  });

  it('permite el login con el PIN de pánico y archiva todos los chats en silencio', async () => {
    const { authRouter } = await import('../modules/auth/controller');
    const handler = getHandler(authRouter, '/otp/verify');
    mockUserFindUnique.mockResolvedValue({
      id: 'user-1', phone: '+54911', passwordHash: 'hash-real',
      settings: { panicPinHash: 'hash-panic' }
    });
    mockCompare.mockImplementation(async (_input: string, hash: string) => hash === 'hash-panic');

    const req: any = { body: { phone: '+54911', otp: '123456', password: 'mi-pin-de-panico' }, headers: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUserUpdateMany).toHaveBeenCalledWith({ where: { userId: 'user-1' }, data: { isArchived: true } });
    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }));
  });

  it('no toca los chats si el login es con la contraseña real (no dispara el pánico)', async () => {
    const { authRouter } = await import('../modules/auth/controller');
    const handler = getHandler(authRouter, '/otp/verify');
    mockUserFindUnique.mockResolvedValue({
      id: 'user-1', phone: '+54911', passwordHash: 'hash-real',
      settings: { panicPinHash: 'hash-panic' }
    });
    mockCompare.mockImplementation(async (_input: string, hash: string) => hash === 'hash-real');

    const req: any = { body: { phone: '+54911', otp: '123456', password: 'mi-clave-real' }, headers: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUserUpdateMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }));
  });
});
