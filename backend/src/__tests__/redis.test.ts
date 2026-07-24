import { redis } from '../core/database/redis';

describe('Sistema de Cache Resiliente (Redis opcional)', () => {
  it('usa memoria cuando no hay REDIS_URL', () => {
    expect(redis.isReal).toBe(false);
  });

  it('guarda y lee un valor', async () => {
    await redis.set('test:key', 'valor123');
    const result = await redis.get('test:key');
    expect(result).toBe('valor123');
  });

  it('respeta el TTL de expiración', async () => {
    await redis.set('test:ttl', 'temporal', 'EX', 1);
    const before = await redis.get('test:ttl');
    expect(before).toBe('temporal');
    await new Promise((r) => setTimeout(r, 1100));
    const after = await redis.get('test:ttl');
    expect(after).toBeNull();
  });

  it('incr incrementa secuencialmente', async () => {
    await redis.del('test:counter');
    const a = await redis.incr('test:counter');
    const b = await redis.incr('test:counter');
    const c = await redis.incr('test:counter');
    expect([a, b, c]).toEqual([1, 2, 3]);
  });

  it('lpush/rpop funcionan como cola FIFO', async () => {
    await redis.lpush('test:queue', 'primero');
    await redis.lpush('test:queue', 'segundo');
    const popped = await redis.rpop('test:queue');
    expect(popped).toBe('primero');
  });
});
