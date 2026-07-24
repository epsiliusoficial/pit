// Sistema nuevo "2FA con TOTP" (RFC 6238): segundo factor de autenticación
// real, compatible con cualquier app estándar (Google Authenticator, Authy,
// 1Password, etc.) — no es una implementación de juguete: HMAC-SHA1 real,
// base32 real, ventana de tolerancia real para desfasajes de reloj.
//
// Se implementa acá mismo en vez de agregar una dependencia externa (menos
// superficie de terceros que auditar para algo que es criptografía estándar
// y bien especificada).
import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
// Tolerancia de ±1 paso (30s para atrás y para adelante) para desfasajes de
// reloj razonables entre el server y el teléfono del usuario — sin esto,
// cualquier drift mínimo invalida todos los códigos.
const WINDOW_TOLERANCE = 1;

export function generateTotpSecret(): string {
  // 20 bytes (160 bits) es el tamaño estándar recomendado por RFC 4226/6238.
  const bytes = crypto.randomBytes(20);
  return base32Encode(bytes);
}

export function buildOtpauthUrl(secret: string, accountName: string, issuer = 'PitOS'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS)
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function base32Encode(buffer: Buffer): string {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue; // ignora caracteres inválidos (separadores, espacios)
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secretBuffer: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binCode % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/**
 * Verifica un código TOTP contra el secret, probando la ventana de tiempo
 * actual y ±1 paso (tolerancia de reloj). Comparación en tiempo constante
 * para no filtrar por timing cuánto matchea un intento parcial.
 */
export function verifyTotpCode(secret: string, code: string, atTimeMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secretBuffer = base32Decode(secret);
  const currentCounter = Math.floor(atTimeMs / 1000 / STEP_SECONDS);

  for (let errorWindow = -WINDOW_TOLERANCE; errorWindow <= WINDOW_TOLERANCE; errorWindow++) {
    const candidate = hotp(secretBuffer, currentCounter + errorWindow);
    const a = Buffer.from(candidate);
    const b = Buffer.from(code);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}
