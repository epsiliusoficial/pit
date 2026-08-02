// Sistema OTP: generación con crypto.randomInt (seguro), y límite real de
// intentos de verificación — bugs reales corregidos acá:
//
// 1. Antes se usaba Math.random() para generar el código, que NO es
//    criptográficamente seguro (es predecible con suficientes muestras).
//    Ahora usa crypto.randomInt(), la fuente de aleatoriedad correcta para
//    esto.
// 2. No había límite de intentos de verificación — un atacante podía probar
//    las 1.000.000 de combinaciones posibles de un OTP de 6 dígitos dentro
//    de la ventana de 5 minutos, sin ninguna restricción más allá del rate
//    limit global por IP (que rota fácil). Ahora se cuenta cada intento
//    fallido y, tras 5 intentos, el código queda invalidado — hay que pedir
//    uno nuevo.
import crypto from 'crypto';
import { redis } from '../../core/database/redis';
import { safeCompare } from '../../core/utils/safeCompare';

const OTP_TTL_SECONDS = 300;
const MAX_ATTEMPTS = 5;

export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export async function storeOtp(phone: string, otp: string) {
  await redis.set(`otp:${phone}`, otp, 'EX', OTP_TTL_SECONDS);
  await redis.del(`otp:attempts:${phone}`); // un código nuevo resetea el contador de intentos
}

export async function verifyOtp(phone: string, otp: string): Promise<boolean> {
  const attemptsKey = `otp:attempts:${phone}`;
  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) await redis.expire(attemptsKey, OTP_TTL_SECONDS);

  if (attempts > MAX_ATTEMPTS) {
    return false; // demasiados intentos: se invalida, hay que pedir un código nuevo
  }

  const stored = await redis.get(`otp:${phone}`);
  if (stored && safeCompare(stored, otp)) {
    await redis.del(`otp:${phone}`);
    await redis.del(attemptsKey);
    return true;
  }
  return false;
}
