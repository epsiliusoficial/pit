import { isMasterKeyConfigured, _resetMasterKeyCacheForTests } from '../core/crypto/messageEncryption';

describe('isMasterKeyConfigured — chequeo proactivo para el healthcheck (bug de observabilidad corregido)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetMasterKeyCacheForTests();
  });

  it('devuelve true con una clave válida configurada', () => {
    process.env.ENCRYPTION_MASTER_KEY = 'a'.repeat(64); // 32 bytes en hex
    expect(isMasterKeyConfigured()).toBe(true);
  });

  it('devuelve false con una clave de longitud inválida', () => {
    process.env.ENCRYPTION_MASTER_KEY = 'no-es-una-clave-valida';
    expect(isMasterKeyConfigured()).toBe(false);
  });

  it('devuelve false si falta en producción (antes esto recién explotaba con el primer mensaje real)', () => {
    delete process.env.ENCRYPTION_MASTER_KEY;
    process.env.NODE_ENV = 'production';
    expect(isMasterKeyConfigured()).toBe(false);
  });

  it('devuelve true en desarrollo aunque falte (usa la clave de dev automáticamente)', () => {
    delete process.env.ENCRYPTION_MASTER_KEY;
    process.env.NODE_ENV = 'development';
    expect(isMasterKeyConfigured()).toBe(true);
  });
});
