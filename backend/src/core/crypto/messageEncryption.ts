// Sistema "Cifrado de Mensajes en Reposo": AES-256-GCM real con una clave
// maestra del servidor (ENCRYPTION_MASTER_KEY). Esto es DISTINTO de cifrado
// E2E verdadero — el servidor sí puede descifrar (necesita hacerlo para
// búsqueda, IA, y exportación), pero el contenido nunca queda en texto
// plano en el disco de la base de datos. Protege contra: un dump de la
// base de datos filtrado, un backup robado, un acceso de solo-lectura no
// autorizado, o una inyección SQL que solo permita leer filas. NO protege
// contra alguien con acceso al proceso del servidor en producción (que sí
// puede leer la clave y descifrar todo) — cifrado E2E real requeriría que
// las claves privadas vivan solo en el dispositivo del usuario.
import crypto from 'crypto';
import { logger } from '../utils/logger';

let cachedKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const envKey = process.env.ENCRYPTION_MASTER_KEY;
  if (envKey) {
    const buf = Buffer.from(envKey, 'hex');
    if (buf.length !== 32) {
      throw new Error('ENCRYPTION_MASTER_KEY debe ser exactamente 32 bytes en hexadecimal (64 caracteres)');
    }
    cachedKey = buf;
    return cachedKey;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ENCRYPTION_MASTER_KEY no está configurada y NODE_ENV=production. ' +
      'El servidor se niega a arrancar sin una clave de cifrado real.'
    );
  }

  logger.warn('ENCRYPTION_MASTER_KEY no configurada — usando clave de desarrollo. NUNCA uses esto en producción.');
  cachedKey = crypto.createHash('sha256').update('clave_de_desarrollo_local_insegura').digest();
  return cachedKey;
}

// Prefijo para distinguir contenido ya cifrado de contenido legado en texto
// plano (mensajes viejos, si los hubiera) durante la migración.
const ENC_PREFIX = 'enc1:';

export function encryptContent(plainText: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString('base64');
  return ENC_PREFIX + payload;
}

export function decryptContent(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;

  const key = getMasterKey();
  const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function _resetMasterKeyCacheForTests() {
  cachedKey = null;
}

/**
 * Valida que la clave maestra esté configurada correctamente, SIN cifrar
 * contenido real. Pensado para el healthcheck: antes, un `ENCRYPTION_MASTER_KEY`
 * mal configurado en producción recién se notaba cuando alguien mandaba el
 * primer mensaje real (el 500 aparecía ahí, no en el healthcheck, que
 * reportaba "ok" tranquilamente). Ahora se puede chequear proactivamente.
 */
export function isMasterKeyConfigured(): boolean {
  try {
    getMasterKey();
    return true;
  } catch {
    return false;
  }
}
