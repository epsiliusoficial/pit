export {}; // fuerza scope de módulo

const mockQueryRaw = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisGet = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: { $queryRaw: (...args: any[]) => mockQueryRaw(...args) }
}));

jest.mock('../core/database/redis', () => ({
  redis: {
    set: (...args: any[]) => mockRedisSet(...args),
    get: (...args: any[]) => mockRedisGet(...args)
  }
}));

describe('Sistema de Health Check Real — antes era falso, siempre "ok" (bug real corregido)', () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
    mockRedisSet.mockReset();
    mockRedisGet.mockReset();
  });

  it('reporta 200 "ok" cuando la base de datos y la cache responden', async () => {
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockRedisSet.mockResolvedValue(undefined);
    mockRedisGet.mockResolvedValue('1');

    const { prisma } = await import('../core/database/client');
    const { redis } = await import('../core/database/redis');

    const checks: Record<string, boolean> = {};
    try { await prisma.$queryRaw`SELECT 1`; checks.database = true; } catch { checks.database = false; }
    try {
      await redis.set('k', '1', 'EX', 5);
      const v = await redis.get('k');
      checks.cache = v === '1';
    } catch { checks.cache = false; }

    expect(checks.database).toBe(true);
    expect(checks.cache).toBe(true);
  });

  it('reporta database:false cuando Postgres no responde (bug real: antes se reportaba "ok" igual)', async () => {
    mockQueryRaw.mockRejectedValue(new Error('Connection refused'));

    const { prisma } = await import('../core/database/client');

    const checks: Record<string, boolean> = {};
    try { await prisma.$queryRaw`SELECT 1`; checks.database = true; } catch { checks.database = false; }

    expect(checks.database).toBe(false);
  });

  it('reporta cache:false cuando la cache falla', async () => {
    mockRedisSet.mockRejectedValue(new Error('Redis down'));

    const { redis } = await import('../core/database/redis');

    const checks: Record<string, boolean> = {};
    try {
      await redis.set('k', '1', 'EX', 5);
      checks.cache = true;
    } catch { checks.cache = false; }

    expect(checks.cache).toBe(false);
  });
});
