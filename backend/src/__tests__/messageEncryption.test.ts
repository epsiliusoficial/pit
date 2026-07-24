import { encryptContent, decryptContent, _resetMasterKeyCacheForTests } from '../core/crypto/messageEncryption';

describe('Sistema de Cifrado de Mensajes en Reposo (AES-256-GCM)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetMasterKeyCacheForTests();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('cifra y descifra un mensaje correctamente (round-trip)', () => {
    const original = 'Hola, este es un mensaje secreto 🔒';
    const encrypted = encryptContent(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted).toMatch(/^enc1:/);
    expect(decryptContent(encrypted)).toBe(original);
  });

  it('el mismo texto cifrado dos veces produce resultados distintos (IV aleatorio)', () => {
    const a = encryptContent('mismo texto');
    const b = encryptContent('mismo texto');
    expect(a).not.toBe(b);
    expect(decryptContent(a)).toBe('mismo texto');
    expect(decryptContent(b)).toBe('mismo texto');
  });

  it('contenido legado sin el prefijo "enc1:" se devuelve tal cual (compatibilidad hacia atrás)', () => {
    const legacyPlainText = 'este mensaje es de antes de activar el cifrado';
    expect(decryptContent(legacyPlainText)).toBe(legacyPlainText);
  });

  it('FALLA en producción si no hay ENCRYPTION_MASTER_KEY configurada', () => {
    delete process.env.ENCRYPTION_MASTER_KEY;
    process.env.NODE_ENV = 'production';
    expect(() => encryptContent('algo')).toThrow(/ENCRYPTION_MASTER_KEY/);
  });

  it('en desarrollo, sin la clave configurada, funciona con un fallback', () => {
    delete process.env.ENCRYPTION_MASTER_KEY;
    process.env.NODE_ENV = 'development';
    expect(() => encryptContent('algo')).not.toThrow();
  });

  it('rechaza una ENCRYPTION_MASTER_KEY que no tenga 32 bytes', () => {
    process.env.ENCRYPTION_MASTER_KEY = 'muy-corta';
    expect(() => encryptContent('algo')).toThrow(/32 bytes/);
  });
});
