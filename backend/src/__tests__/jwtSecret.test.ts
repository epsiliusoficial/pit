import { getJwtSecret, _resetJwtSecretCacheForTests } from '../core/utils/jwtSecret';

describe('Sistema de JWT Secret Seguro — bug crítico corregido', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetJwtSecretCacheForTests();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('usa el JWT_SECRET configurado si existe', () => {
    process.env.JWT_SECRET = 'mi-secret-super-largo-y-random';
    expect(getJwtSecret()).toBe('mi-secret-super-largo-y-random');
  });

  it('FALLA (lanza excepción) en producción si no hay JWT_SECRET configurado', () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';
    // Prueba del bug real: antes, esto silenciosamente usaba 'dev_secret' en
    // producción. Ahora debe lanzar una excepción clara.
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET no está configurada/);
  });

  it('en desarrollo, sin JWT_SECRET, usa un fallback pero NO lanza excepción', () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'development';
    expect(() => getJwtSecret()).not.toThrow();
    expect(getJwtSecret()).toBe('dev_secret_solo_para_desarrollo_local');
  });

  it('cachea el secret (no lo relee de env en cada llamada)', () => {
    process.env.JWT_SECRET = 'primer-valor';
    const first = getJwtSecret();
    process.env.JWT_SECRET = 'segundo-valor';
    const second = getJwtSecret();
    expect(first).toBe(second); // sigue siendo 'primer-valor', cacheado
  });
});
