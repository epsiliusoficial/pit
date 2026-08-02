export {}; // fuerza scope de módulo

const mockUserFindUnique = jest.fn();
const mockDeviceFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) },
    device: { findUnique: (...args: any[]) => mockDeviceFindUnique(...args) }
  }
}));

process.env.JWT_SECRET = 'test-secret-para-este-archivo';

import jwt from 'jsonwebtoken';
import { authMiddleware } from '../modules/auth/middleware';

describe('Sistema de Revocación de Sesión Real — antes era cosmético (bug funcional corregido)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockDeviceFindUnique.mockReset();
    mockUserFindUnique.mockResolvedValue({ tier: 'FREE' });
  });

  it('permite el acceso si el deviceId del token todavía existe', async () => {
    mockDeviceFindUnique.mockResolvedValue({ id: 'device1' });

    const token = jwt.sign({ userId: 'user1', deviceId: 'device1' }, 'test-secret-para-este-archivo');
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe('user1');
  });

  it('RECHAZA el token si el dispositivo fue revocado/borrado (la prueba real del fix)', async () => {
    // Antes de este fix: borrar un "Device" de la lista era cosmético — el
    // JWT seguía sirviendo igual hasta expirar solo (hasta 7 días después).
    mockDeviceFindUnique.mockResolvedValue(null);

    const token = jwt.sign({ userId: 'user1', deviceId: 'device-borrado' }, 'test-secret-para-este-archivo');
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Sesión revocada desde otro dispositivo' });
  });

  it('sigue funcionando con tokens sin deviceId (compatibilidad hacia atrás)', async () => {
    const token = jwt.sign({ userId: 'user1' }, 'test-secret-para-este-archivo');
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockDeviceFindUnique).not.toHaveBeenCalled();
  });
});
