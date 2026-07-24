jest.mock('../core/database/client', () => ({ prisma: {} }));
jest.mock('../core/database/redis', () => ({ redis: {} }));

import { getRpID, getOrigin } from '../modules/biometric/controller';

describe('Sistema Biométrico (WebAuthn) — fix de origen confiable', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.FRONTEND_URL;
    delete process.env.WEBAUTHN_RP_ID;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('en producción, sin FRONTEND_URL/WEBAUTHN_RP_ID, RECHAZA con excepción (no confía en el Host del request)', () => {
    process.env.NODE_ENV = 'production';
    const fakeReq = { hostname: 'atacante-controla-esto.evil.com' };

    // Prueba real del bug corregido: antes esto devolvía silenciosamente el
    // hostname que mandó el cliente. Ahora debe rechazar explícitamente.
    expect(() => getRpID(fakeReq)).toThrow(/WEBAUTHN_RP_ID o FRONTEND_URL/);
  });

  it('en producción, sin FRONTEND_URL, getOrigin también rechaza (no confía en el header Host)', () => {
    process.env.NODE_ENV = 'production';
    const fakeReq = { protocol: 'https', get: () => 'atacante-controla-esto.evil.com' };
    expect(() => getOrigin(fakeReq)).toThrow(/FRONTEND_URL/);
  });

  it('en producción, CON FRONTEND_URL configurada, usa ese valor y no el del request', () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://pit.vercel.app';
    const fakeReq = { hostname: 'atacante.evil.com', protocol: 'https', get: () => 'atacante.evil.com' };

    expect(getRpID(fakeReq)).toBe('pit.vercel.app');
    expect(getOrigin(fakeReq)).toBe('https://pit.vercel.app');
  });

  it('en desarrollo, sin configuración, cae al request (comportamiento de conveniencia local)', () => {
    process.env.NODE_ENV = 'development';
    const fakeReq = { hostname: 'localhost', protocol: 'http', get: () => 'localhost:3000' };

    expect(() => getRpID(fakeReq)).not.toThrow();
    expect(getRpID(fakeReq)).toBe('localhost');
  });
});
