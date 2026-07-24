// Sistema "Fuego Rápido" (#8 de la idea original): límite real anti-spam.
// Máximo N mensajes por minuto por usuario, contado en Redis con TTL.
import { Response, NextFunction } from 'express';
import { redis } from '../../core/database/redis';
import { AuthRequest } from '../auth/middleware';

const LIMIT = 30; // mensajes por minuto
const WINDOW_SECONDS = 60;

export async function rateLimiter(req: AuthRequest, res: Response, next: NextFunction) {
  const key = `ratelimit:${req.userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_SECONDS);
  if (count > LIMIT) {
    return res.status(429).json({ error: 'Estás enviando mensajes muy rápido. Esperá unos segundos.' });
  }
  next();
}
