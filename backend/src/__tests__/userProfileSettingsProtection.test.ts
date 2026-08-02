export {}; // scope de módulo propio

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      update: (...args: any[]) => mockUpdate(...args)
    }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('PUT /api/user/me — no puede pisar el estado de 2FA (bug de seguridad corregido)', () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
  });

  it('conserva settings.totp aunque el cliente mande settings:{} para pisar todo', async () => {
    const { userRouter } = await import('../modules/auth/user.controller');
    const handler = getHandler(userRouter, 'put', '/me');

    mockFindUnique.mockResolvedValue({
      settings: { theme: 'dark', totp: { secret: 'SECRETO', enabled: true, recoveryCodeHashes: ['h1'] } }
    });
    mockUpdate.mockResolvedValue({ id: 'user-1', name: 'Mateo', settings: {} });

    const req: any = { userId: 'user-1', body: { settings: {} } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const dataArg = mockUpdate.mock.calls[0][0].data;
    expect(dataArg.settings.totp).toEqual({ secret: 'SECRETO', enabled: true, recoveryCodeHashes: ['h1'] });
  });

  it('igual permite cambiar otras claves de settings (theme, lang) normalmente', async () => {
    const { userRouter } = await import('../modules/auth/user.controller');
    const handler = getHandler(userRouter, 'put', '/me');

    mockFindUnique.mockResolvedValue({ settings: { theme: 'dark' } });
    mockUpdate.mockResolvedValue({ id: 'user-1', name: 'Mateo', settings: {} });

    const req: any = { userId: 'user-1', body: { settings: { theme: 'light' } } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const dataArg = mockUpdate.mock.calls[0][0].data;
    expect(dataArg.settings.theme).toBe('light');
  });

  it('rechaza un avatarUrl con protocolo no http/https', async () => {
    const { userRouter } = await import('../modules/auth/user.controller');
    const handler = getHandler(userRouter, 'put', '/me');

    const req: any = { userId: 'user-1', body: { avatarUrl: 'javascript:alert(1)' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rechaza un bio excesivamente largo', async () => {
    const { userRouter } = await import('../modules/auth/user.controller');
    const handler = getHandler(userRouter, 'put', '/me');

    const req: any = { userId: 'user-1', body: { bio: 'x'.repeat(501) } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
