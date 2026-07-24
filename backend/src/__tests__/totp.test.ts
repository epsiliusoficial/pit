import crypto from 'crypto';
import { generateTotpSecret, verifyTotpCode, buildOtpauthUrl } from '../core/crypto/totp';

// Implementación mínima de HOTP/TOTP de referencia, independiente del código
// bajo test, para generar códigos "correctos" con los que probar la
// verificación (si copiara la función interna del módulo no probaría nada).
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of input.toUpperCase()) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function referenceTotp(secret: string, atMs: number): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (binCode % 1_000_000).toString().padStart(6, '0');
}

describe('Sistema 2FA — TOTP (RFC 6238)', () => {
  it('acepta el código correcto para el instante actual', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = referenceTotp(secret, now);
    expect(verifyTotpCode(secret, code, now)).toBe(true);
  });

  it('rechaza un código incorrecto', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, '000000', Date.now())).toBe(false);
  });

  it('rechaza entradas con formato inválido (no 6 dígitos)', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, 'abcdef', Date.now())).toBe(false);
    expect(verifyTotpCode(secret, '12345', Date.now())).toBe(false);
  });

  it('tolera un desfasaje de reloj de ±1 paso (30s)', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const codeFromPreviousStep = referenceTotp(secret, now - 30_000);
    expect(verifyTotpCode(secret, codeFromPreviousStep, now)).toBe(true);
  });

  it('rechaza un código de hace más de 1 paso de tolerancia', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const codeFromFarPast = referenceTotp(secret, now - 5 * 30_000);
    expect(verifyTotpCode(secret, codeFromFarPast, now)).toBe(false);
  });

  it('genera un otpauth:// URL válido para escanear con Authenticator', () => {
    const secret = generateTotpSecret();
    const url = buildOtpauthUrl(secret, '+5491100000000');
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain(`secret=${secret}`);
  });
});
