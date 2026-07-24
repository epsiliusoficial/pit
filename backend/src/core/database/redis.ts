// Sistema "Cache Resiliente": si REDIS_URL existe, usa Redis real. Si no existe,
// usa memoria RAM automáticamente — el backend NUNCA debe caerse por falta de Redis.
// Misma interfaz (get/set/del/incr/expire/lpush/rpop) para que el resto del código
// no sepa ni le importe cuál de los dos está corriendo debajo.
import Redis from 'ioredis';
import { logger } from '../utils/logger';

interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: 'EX', ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * Lee y borra en una sola operación atómica. Necesario para "tokens de un
   * solo uso" (ej: QR login) — con get()+del() por separado, dos requests
   * concurrentes pueden leer el valor ANTES de que cualquiera lo borre, y
   * ambas terminan con el mismo token de sesión de un solo uso.
   */
  getdel(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  lpush(key: string, value: string): Promise<void>;
  rpop(key: string): Promise<string | null>;
  isReal: boolean;
}

// --- Implementación en memoria (fallback real, no un mock) ---
class MemoryCache implements CacheClient {
  isReal = false;
  private store = new Map<string, { value: string; expiresAt?: number }>();
  private lists = new Map<string, string[]>();

  private isExpired(entry?: { value: string; expiresAt?: number }): boolean {
    return !!entry?.expiresAt && entry.expiresAt < Date.now();
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, mode?: 'EX', ttlSeconds?: number): Promise<void> {
    const expiresAt = mode === 'EX' && ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async getdel(key: string): Promise<string | null> {
    // En memoria esto ya es atómico: JS es single-threaded y no hay ningún
    // `await` entre leer y borrar, así que no puede intercalarse otra
    // request en el medio.
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    this.store.delete(key);
    return entry.value;
  }

  async incr(key: string): Promise<number> {
    const current = await this.get(key);
    const next = (current ? parseInt(current, 10) : 0) + 1;
    const existing = this.store.get(key);
    this.store.set(key, { value: String(next), expiresAt: existing?.expiresAt });
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.store.get(key);
    if (entry) entry.expiresAt = Date.now() + ttlSeconds * 1000;
  }

  async lpush(key: string, value: string): Promise<void> {
    const list = this.lists.get(key) || [];
    list.unshift(value);
    this.lists.set(key, list);
  }

  async rpop(key: string): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list || list.length === 0) return null;
    return list.pop() || null;
  }
}

// --- Wrapper real de ioredis, con manejo de errores para que nunca tumbe el proceso ---
class RedisCache implements CacheClient {
  isReal = true;
  private client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
      lazyConnect: false
    });
    // Sistema "Sin caídas por Redis": cualquier error se loguea, nunca revienta el proceso.
    this.client.on('error', (err) => logger.warn(`Redis error (se ignora, no tumba el backend): ${err.message}`));
  }

  async get(key: string) { return this.client.get(key); }
  async set(key: string, value: string, mode?: 'EX', ttlSeconds?: number) {
    if (mode === 'EX' && ttlSeconds) await this.client.set(key, value, 'EX', ttlSeconds);
    else await this.client.set(key, value);
  }
  async del(key: string) { await this.client.del(key); }

  async getdel(key: string): Promise<string | null> {
    // EVAL con Lua garantiza atomicidad en cualquier versión de Redis (GETDEL
    // nativo recién existe desde Redis 6.2) — el GET y el DEL corren como una
    // sola operación indivisible del lado del servidor de Redis.
    const script = `
      local v = redis.call('GET', KEYS[1])
      if v then redis.call('DEL', KEYS[1]) end
      return v
    `;
    const result = await this.client.eval(script, 1, key);
    return (result as string | null) ?? null;
  }
  async incr(key: string) { return this.client.incr(key); }
  async expire(key: string, ttlSeconds: number) { await this.client.expire(key, ttlSeconds); }
  async lpush(key: string, value: string) { await this.client.lpush(key, value); }
  async rpop(key: string) { return this.client.rpop(key); }
}

const REDIS_URL = process.env.REDIS_URL;

export const redis: CacheClient = REDIS_URL ? new RedisCache(REDIS_URL) : new MemoryCache();

if (REDIS_URL) {
  logger.info('Cache: usando Redis real.');
} else {
  logger.info('Cache: REDIS_URL no configurada, usando memoria RAM automáticamente.');
}

export async function setPresence(userId: string, isOnline: boolean) {
  if (isOnline) {
    await redis.set(`presence:${userId}`, '1', 'EX', 60);
  } else {
    await redis.del(`presence:${userId}`);
  }
}

export async function isUserOnline(userId: string): Promise<boolean> {
  const val = await redis.get(`presence:${userId}`);
  return val === '1';
}

export async function setTyping(chatId: string, userId: string) {
  await redis.set(`typing:${chatId}:${userId}`, '1', 'EX', 5);
}
