describe('Cache en memoria — getdel (primitiva atómica para tokens de un solo uso)', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.REDIS_URL;
  });

  it('devuelve el valor y lo borra en una sola operación', async () => {
    const { redis } = await import('../core/database/redis');
    await redis.set('k1', 'valor-secreto');

    const result = await redis.getdel('k1');
    expect(result).toBe('valor-secreto');

    const afterward = await redis.get('k1');
    expect(afterward).toBeNull();
  });

  it('devuelve null si la clave no existe', async () => {
    const { redis } = await import('../core/database/redis');
    const result = await redis.getdel('no-existe');
    expect(result).toBeNull();
  });

  it('devuelve null si la clave ya expiró', async () => {
    const { redis } = await import('../core/database/redis');
    await redis.set('k2', 'valor', 'EX', -1); // ya vencido
    const result = await redis.getdel('k2');
    expect(result).toBeNull();
  });
});
