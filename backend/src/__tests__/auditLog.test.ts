const mockCreate = jest.fn();
jest.mock('../core/database/client', () => ({
  prisma: { auditLog: { create: (...args: any[]) => mockCreate(...args) } }
}));

import { auditLog } from '../core/audit/auditLog';

describe('Sistema de Auditoría', () => {
  beforeEach(() => mockCreate.mockClear());

  it('registra una acción con todos los campos', async () => {
    await auditLog({ userId: 'u1', action: 'USER_BANNED', targetId: 'u2', ip: '1.2.3.4' });

    expect(mockCreate).toHaveBeenCalledWith({
      data: { userId: 'u1', action: 'USER_BANNED', targetId: 'u2', metadata: undefined, ip: '1.2.3.4' }
    });
  });

  it('no lanza excepción si falla la escritura (no debe tumbar la operación principal)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('DB caída'));
    await expect(auditLog({ action: 'LOGIN', userId: 'u1' })).resolves.not.toThrow();
  });
});
