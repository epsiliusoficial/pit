// Sistema "JWT Secret Seguro": antes, 7 lugares distintos usaban
// `process.env.JWT_SECRET || 'dev_secret'` cada uno por su cuenta. Bug real
// y serio: si alguien despliega a producción sin configurar JWT_SECRET (un
// error de configuración fácil de cometer, no un ataque), TODOS los tokens
// quedan firmados con el string público 'dev_secret' — cualquiera podría
// forjar un JWT válido para cualquier userId y suplantar a cualquier cuenta.
//
// Esta función centraliza el secret en un solo lugar y falla fuerte (lanza
// una excepción que tumba el arranque del servidor) si NODE_ENV=production
// y no hay JWT_SECRET configurado. Es mejor que el servidor no arranque, a
// que arranque silenciosamente con una vulnerabilidad crítica.
import { logger } from './logger';

let cachedSecret: string | null = null;
let warnedOnce = false;

export function getJwtSecret(): string {
  if (cachedSecret) return cachedSecret;

  const envSecret = process.env.JWT_SECRET;
  if (envSecret) {
    cachedSecret = envSecret;
    return cachedSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET no está configurada y NODE_ENV=production. ' +
      'El servidor se niega a arrancar con un secret inseguro por defecto — ' +
      'configurá JWT_SECRET con un valor random largo antes de desplegar.'
    );
  }

  if (!warnedOnce) {
    logger.warn('JWT_SECRET no configurada — usando secret de desarrollo. NUNCA uses esto en producción.');
    warnedOnce = true;
  }
  cachedSecret = 'dev_secret_solo_para_desarrollo_local';
  return cachedSecret;
}

// Para tests: permite resetear el cache entre casos.
export function _resetJwtSecretCacheForTests() {
  cachedSecret = null;
  warnedOnce = false;
}
