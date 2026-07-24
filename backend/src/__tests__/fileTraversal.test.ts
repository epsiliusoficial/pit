jest.mock('../core/database/client', () => ({ prisma: {} }));

import { isValidFileId } from '../modules/files/controller';

describe('Sistema de Archivos — fix de path traversal (bug real encontrado)', () => {
  it('acepta un fileId válido (32 hex chars, el formato que genera el propio sistema)', () => {
    expect(isValidFileId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(true);
  });

  it('rechaza un intento de path traversal hacia arriba', () => {
    expect(isValidFileId('../../../../etc/passwd')).toBe(false);
  });

  it('rechaza un path traversal con codificación de barras', () => {
    expect(isValidFileId('..%2f..%2f..%2fetc%2fpasswd')).toBe(false);
  });

  it('rechaza un path absoluto', () => {
    expect(isValidFileId('/etc/passwd')).toBe(false);
  });

  it('rechaza un fileId con longitud incorrecta', () => {
    expect(isValidFileId('abc123')).toBe(false);
  });

  it('rechaza caracteres no hexadecimales', () => {
    expect(isValidFileId('g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(false);
  });
});
