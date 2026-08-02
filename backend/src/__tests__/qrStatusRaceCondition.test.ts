export {}; // scope de módulo propio

const mockStatusGet = jest.fn();
const mockGetdel = jest.fn();
const mockSet = jest.fn();

jest.mock('../core/database/redis', () => ({
  redis: {
    get: (...args: any[]) => mockStatusGet(...args),
    getdel: (...args: any[]) => mockGetdel(...args),
    set: (...args: any[]) => mockSet(...args)
  }
}));
jest.mock('../core/database/client', () => ({ prisma: { user: { findUnique: jest.fn() }, device: { create: jest.fn() } } }));
jest.mock('../core/audit/auditLog', () => ({ auditLog: jest.fn() }));
jest.mock('../core/utils/jwtSecret', () => ({ getJwtSecret: () => 'test-secret' }));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('QR login /status — entrega del token de un solo uso (race condition corregida)', () => {
  beforeEach(() => {
    mockStatusGet.mockReset();
    mockGetdel.mockReset();
    mockSet.mockReset();
  });

  it('devuelve ready:false si todavía no fue aprobado', async () => {
    mockStatusGet.mockResolvedValue('pending');
    const { qrRouter } = await import('../modules/auth/qr.controller');
    const handler = getHandler(qrRouter, '/status/:code');

    const req: any = { params: { code: 'abc' } };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ ready: false });
    expect(mockGetdel).not.toHaveBeenCalled();
  });

  it('entrega el token la primera vez que consulta después de aprobado', async () => {
    mockStatusGet.mockResolvedValue('claimed');
    mockGetdel.mockResolvedValue(JSON.stringify({ token: 'jwt-real', userId: 'u1', name: 'Mateo' }));
    const { qrRouter } = await import('../modules/auth/qr.controller');
    const handler = getHandler(qrRouter, '/status/:code');

    const req: any = { params: { code: 'abc' } };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ ready: true, token: 'jwt-real', userId: 'u1', name: 'Mateo' });
  });

  it('la segunda consulta (o una concurrente) NO recibe el mismo token dos veces', async () => {
    mockStatusGet.mockResolvedValue('claimed');
    // getdel ya lo consumió: la segunda llamada devuelve null (comportamiento real de getdel).
    mockGetdel.mockResolvedValue(null);
    const { qrRouter } = await import('../modules/auth/qr.controller');
    const handler = getHandler(qrRouter, '/status/:code');

    const req: any = { params: { code: 'abc' } };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ ready: false });
  });
});
