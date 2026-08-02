export {}; // scope de módulo propio

const mockDeviceCreate = jest.fn();
jest.mock('../core/database/client', () => ({
  prisma: { device: { create: (...args: any[]) => mockDeviceCreate(...args) } }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Registro de dispositivos — límite de longitud (hardening agregado)', () => {
  beforeEach(() => mockDeviceCreate.mockReset());

  it('rechaza un deviceName demasiado largo', async () => {
    const { deviceRouter } = await import('../modules/auth/devices');
    const handler = getHandler(deviceRouter, 'post', '/register');
    const req: any = { userId: 'u1', body: { deviceName: 'x'.repeat(101) } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockDeviceCreate).not.toHaveBeenCalled();
  });

  it('rechaza un userAgent demasiado largo', async () => {
    const { deviceRouter } = await import('../modules/auth/devices');
    const handler = getHandler(deviceRouter, 'post', '/register');
    const req: any = { userId: 'u1', body: { userAgent: 'x'.repeat(301) } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockDeviceCreate).not.toHaveBeenCalled();
  });

  it('acepta un deviceName normal', async () => {
    mockDeviceCreate.mockResolvedValue({ id: 'd1' });
    const { deviceRouter } = await import('../modules/auth/devices');
    const handler = getHandler(deviceRouter, 'post', '/register');
    const req: any = { userId: 'u1', body: { deviceName: 'iPhone de Mateo' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    expect(mockDeviceCreate).toHaveBeenCalled();
  });
});
