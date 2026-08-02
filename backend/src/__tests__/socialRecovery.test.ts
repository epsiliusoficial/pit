export {}; // scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));
jest.mock('../core/utils/jwtSecret', () => ({ getJwtSecret: () => 'test-secret' }));

const mockUserFindMany = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockChatFindFirst = jest.fn();
const mockChatCreate = jest.fn();
const mockMessageCreate = jest.fn();
const mockVerifyOtp = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      findMany: (...args: any[]) => mockUserFindMany(...args),
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      update: (...args: any[]) => mockUserUpdate(...args)
    },
    chat: {
      findFirst: (...args: any[]) => mockChatFindFirst(...args),
      create: (...args: any[]) => mockChatCreate(...args)
    },
    message: { create: (...args: any[]) => mockMessageCreate(...args) }
  }
}));
jest.mock('../modules/auth/otp.service', () => ({
  generateOtp: jest.fn(),
  storeOtp: jest.fn(),
  verifyOtp: (...args: any[]) => mockVerifyOtp(...args)
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Recuperación Social (nuevo)', () => {
  beforeEach(() => {
    mockUserFindMany.mockReset();
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset();
    mockChatFindFirst.mockReset();
    mockChatCreate.mockReset();
    mockMessageCreate.mockReset();
    mockVerifyOtp.mockReset();
  });

  it('rechaza configurar con menos de 2 guardianes', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/setup');

    const req: any = { userId: 'user1', body: { guardianUserIds: ['g1'], threshold: 1 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza si el propio usuario está en la lista de guardianes', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/setup');

    const req: any = { userId: 'user1', body: { guardianUserIds: ['user1', 'g2'], threshold: 1 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza un threshold mayor a la cantidad de guardianes', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/setup');

    const req: any = { userId: 'user1', body: { guardianUserIds: ['g1', 'g2'], threshold: 5 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('configura guardianes correctamente', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/setup');
    mockUserFindMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
    mockUserFindUnique.mockResolvedValue({ settings: {} });

    const req: any = { userId: 'user1', body: { guardianUserIds: ['g1', 'g2'], threshold: 2 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { settings: { socialRecovery: { guardianUserIds: ['g1', 'g2'], threshold: 2, pendingRequest: null } } }
    });
  });

  it('rechaza iniciar una recuperación con OTP inválido', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/request');
    mockVerifyOtp.mockResolvedValue(false);

    const req: any = { body: { phone: '+54911', otp: '000000' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rechaza iniciar recuperación si la cuenta no configuró guardianes', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/request');
    mockVerifyOtp.mockResolvedValue(true);
    mockUserFindUnique.mockResolvedValue({ id: 'user1', settings: {} });

    const req: any = { body: { phone: '+54911', otp: '123456' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('inicia la recuperación y notifica a todos los guardianes', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/request');
    mockVerifyOtp.mockResolvedValue(true);
    mockUserFindUnique.mockResolvedValue({
      id: 'user1', name: 'Ana', settings: { socialRecovery: { guardianUserIds: ['g1', 'g2'], threshold: 2 } }
    });
    mockChatFindFirst.mockResolvedValue(null);
    mockChatCreate.mockResolvedValue({ id: 'chatNuevo' });
    mockMessageCreate.mockResolvedValue({ id: 'msg1' });

    const req: any = { body: { phone: '+54911', otp: '123456' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatCreate).toHaveBeenCalledTimes(2); // uno por guardián
    expect(mockMessageCreate).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ guardiansNotified: 2, threshold: 2 }));
  });

  it('rechaza aprobar si no sos guardián de esa cuenta', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/approve');
    mockUserFindUnique.mockResolvedValue({
      id: 'user1',
      settings: { socialRecovery: { guardianUserIds: ['g1', 'g2'], threshold: 2, pendingRequest: { id: 'req1', approvals: [] } } }
    });

    const req: any = { userId: 'intruso', body: { phone: '+54911', requestId: 'req1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('acumula aprobaciones sin duplicar al mismo guardián dos veces', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/approve');
    mockUserFindUnique.mockResolvedValue({
      id: 'user1',
      settings: { socialRecovery: { guardianUserIds: ['g1', 'g2'], threshold: 2, pendingRequest: { id: 'req1', approvals: ['g1'] } } }
    });

    const req: any = { userId: 'g1', body: { phone: '+54911', requestId: 'req1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ approvals: 1, threshold: 2, reached: false });
  });

  it('marca reached:true al alcanzar el umbral', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/approve');
    mockUserFindUnique.mockResolvedValue({
      id: 'user1',
      settings: { socialRecovery: { guardianUserIds: ['g1', 'g2'], threshold: 2, pendingRequest: { id: 'req1', approvals: ['g1'] } } }
    });

    const req: any = { userId: 'g2', body: { phone: '+54911', requestId: 'req1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ approvals: 2, threshold: 2, reached: true });
  });

  it('status no da resetToken si todavía no se llegó al umbral', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/status');
    mockUserFindUnique.mockResolvedValue({
      id: 'user1',
      settings: { socialRecovery: { guardianUserIds: ['g1', 'g2'], threshold: 2, pendingRequest: { id: 'req1', approvals: ['g1'] } } }
    });

    const req: any = { body: { phone: '+54911', requestId: 'req1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ approved: false, approvals: 1, threshold: 2 });
  });

  it('status da un resetToken real una vez alcanzado el umbral', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/status');
    mockUserFindUnique.mockResolvedValue({
      id: 'user1',
      settings: { socialRecovery: { guardianUserIds: ['g1', 'g2'], threshold: 2, pendingRequest: { id: 'req1', approvals: ['g1', 'g2'] } } }
    });

    const req: any = { body: { phone: '+54911', requestId: 'req1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ approved: true, resetToken: expect.any(String) }));
  });

  it('reset rechaza un token inválido', async () => {
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/reset');

    const req: any = { body: { resetToken: 'no-es-un-jwt', newPassword: 'nueva1234' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('reset cambia la contraseña con un token válido y cierra la recuperación', async () => {
    const jwt = await import('jsonwebtoken');
    const { socialRecoveryRouter } = await import('../modules/auth/socialRecovery');
    const handler = getHandler(socialRecoveryRouter, '/reset');
    const token = jwt.sign({ userId: 'user1', type: 'social-recovery-reset', requestId: 'req1' }, 'test-secret', { expiresIn: '15m' });
    mockUserFindUnique.mockResolvedValue({
      id: 'user1',
      settings: { socialRecovery: { guardianUserIds: ['g1', 'g2'], threshold: 2, pendingRequest: { id: 'req1', approvals: ['g1', 'g2'] } } }
    });

    const req: any = { body: { resetToken: token, newPassword: 'nueva1234' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user1' },
      data: expect.objectContaining({
        settings: expect.objectContaining({ socialRecovery: expect.objectContaining({ pendingRequest: null }) })
      })
    }));
    expect(res.json).toHaveBeenCalledWith({ reset: true });
  });
});
