const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockUserFindUnique = jest.fn();
const mockDeviceCreate = jest.fn();

jest.mock('../core/database/redis', () => ({
  redis: {
    get: (...args: any[]) => mockRedisGet(...args),
    set: (...args: any[]) => mockRedisSet(...args)
  }
}));

jest.mock('../core/database/client', () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) },
    device: { create: (...args: any[]) => mockDeviceCreate(...args) }
  }
}));

jest.mock('../core/audit/auditLog', () => ({ auditLog: jest.fn() }));

import { qrRouter } from '../modules/auth/qr.controller';

function getRouteLayer(path: string) {
  return (qrRouter as any).stack.find((l: any) => l.route?.path === path);
}

describe('Sistema QR Instant Join — bypass de autenticación corregido (bug crítico)', () => {
  beforeEach(() => {
    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
    mockUserFindUnique.mockReset();
    mockDeviceCreate.mockReset();
    mockDeviceCreate.mockResolvedValue({ id: 'device1' });
  });

  it('el endpoint /claim ahora exige autenticación (authMiddleware en el stack de la ruta)', () => {
    const layer = getRouteLayer('/claim');
    // La ruta debe tener MÁS de un handler: authMiddleware primero, el handler real después.
    // Antes del fix, era un solo handler sin protección.
    expect(layer.route.stack.length).toBeGreaterThanOrEqual(2);
  });

  it('usa el userId del token autenticado, NUNCA un teléfono del body (fix del bypass)', async () => {
    const layer = getRouteLayer('/claim');
    const realHandler = layer.route.stack[layer.route.stack.length - 1].handle;

    mockRedisGet.mockResolvedValue('pending');
    mockUserFindUnique.mockResolvedValue({ id: 'usuario-autenticado', name: 'Ana' });

    const req: any = {
      userId: 'usuario-autenticado', // esto viene del JWT verificado por authMiddleware
      body: { code: 'abc123', phone: '+5491111111111' }, // un atacante intentaría poner el teléfono de otro acá
      ip: '1.2.3.4'
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await realHandler(req, res);

    // La prueba real: se buscó al usuario por el ID autenticado, no por el
    // teléfono que mandó el body (que en un ataque real sería el de la víctima).
    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { id: 'usuario-autenticado' } });
    expect(res.json).toHaveBeenCalledWith({ claimed: true });
  });
});
