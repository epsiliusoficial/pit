import { safeCompare } from '../core/utils/safeCompare';

describe('Sistema de Comparación Segura (fix de timing attack)', () => {
  it('devuelve true cuando los strings son idénticos', () => {
    expect(safeCompare('mi-secret-123', 'mi-secret-123')).toBe(true);
  });

  it('devuelve false cuando difieren', () => {
    expect(safeCompare('mi-secret-123', 'otro-secret-456')).toBe(false);
  });

  it('devuelve false (sin lanzar excepción) cuando difieren en longitud', () => {
    expect(safeCompare('corto', 'un-string-bastante-mas-largo')).toBe(false);
  });

  it('es sensible a mayúsculas/minúsculas', () => {
    expect(safeCompare('Secret', 'secret')).toBe(false);
  });
});
