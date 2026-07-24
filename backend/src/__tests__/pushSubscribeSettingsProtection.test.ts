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
jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));
jest.mock('../modules/social/focus', () => ({ shouldNotify: jest.fn() }));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('POST /api/notifications/subscribe — no pisa otros settings (bug de seguridad corregido)', () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
  });

  it('conserva settings.totp existentes al suscribirse a push', async () => {
    const { pushRouter } = await import('../modules/notifications/push');
    const handler = getHandler(pushRouter, 'post', '/subscribe');

    mockFindUnique.mockResolvedValue({
      settings: { theme: 'dark', totp: { secret: 'SECRETO', enabled: true } }
    });
    mockUpdate.mockResolvedValue({});

    const req: any = { userId: 'user-1', body: { subscription: { endpoint: 'https://push.example/abc', keys: {} } } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const dataArg = mockUpdate.mock.calls[0][0].data;
    expect(dataArg.settings.totp).toEqual({ secret: 'SECRETO', enabled: true });
    expect(dataArg.settings.theme).toBe('dark');
    expect(dataArg.settings.pushSubscription).toEqual({ endpoint: 'https://push.example/abc', keys: {} });
  });

  it('rechaza una subscription sin endpoint', async () => {
    const { pushRouter } = await import('../modules/notifications/push');
    const handler = getHandler(pushRouter, 'post', '/subscribe');

    const req: any = { userId: 'user-1', body: { subscription: { keys: {} } } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
