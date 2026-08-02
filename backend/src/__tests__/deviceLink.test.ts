export {}; // scope de módulo

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockGetdel = jest.fn();

jest.mock('../core/database/redis', () => ({
  redis: {
    get: (...args: any[]) => mockGet(...args),
    set: (...args: any[]) => mockSet(...args),
    getdel: (...args: any[]) => mockGetdel(...args)
  }
}));

jest.mock('../core/database/client', () => ({ prisma: {} }));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// Sistema "Vinculación de Dispositivo": el servidor nunca ve una clave
// privada en claro, solo relaciona linkId<->userId y relaya un blob cifrado
// de un solo uso. Estos tests verifican justamente eso: el servidor no
// desencripta nada, y no deja que un usuario reclame o entregue el vínculo
// de otra cuenta.
describe('Vinculación de Dispositivo (E2E real, servidor ciego)', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockGetdel.mockReset();
  });

  it('start genera un linkId atado a la cuenta que lo pide', async () => {
    const { deviceLinkRouter } = await import('../modules/auth/deviceLink');
    const handler = getHandler(deviceLinkRouter, 'post', '/start');

    const req: any = { userId: 'user1' };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockSet).toHaveBeenCalledWith(
      expect.stringMatching(/^devicelink:/),
      expect.stringContaining('"userId":"user1"'),
      'EX',
      expect.any(Number)
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ linkId: expect.any(String) }));
  });

  it('deliver rechaza si el linkId no existe o venció', async () => {
    const { deviceLinkRouter } = await import('../modules/auth/deviceLink');
    const handler = getHandler(deviceLinkRouter, 'post', '/:linkId/deliver');
    mockGet.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { linkId: 'abc' }, body: { ciphertext: 'x', nonce: 'y', senderPublicKey: 'z' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deliver rechaza si el linkId es de otra cuenta', async () => {
    const { deviceLinkRouter } = await import('../modules/auth/deviceLink');
    const handler = getHandler(deviceLinkRouter, 'post', '/:linkId/deliver');
    mockGet.mockResolvedValue(JSON.stringify({ userId: 'user-otro', status: 'pending' }));

    const req: any = { userId: 'user1', params: { linkId: 'abc' }, body: { ciphertext: 'x', nonce: 'y', senderPublicKey: 'z' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('deliver guarda el blob cifrado tal cual, sin tocar su contenido (el servidor no lo puede leer)', async () => {
    const { deviceLinkRouter } = await import('../modules/auth/deviceLink');
    const handler = getHandler(deviceLinkRouter, 'post', '/:linkId/deliver');
    mockGet.mockResolvedValue(JSON.stringify({ userId: 'user1', status: 'pending' }));

    const req: any = {
      userId: 'user1', params: { linkId: 'abc' },
      body: { ciphertext: 'blob-cifrado-real', nonce: 'nonce123', senderPublicKey: 'pub123' }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const savedValue = mockSet.mock.calls[0][1];
    expect(savedValue).toContain('blob-cifrado-real');
    expect(res.json).toHaveBeenCalledWith({ delivered: true });
  });

  it('claim es de un solo uso: si getdel no devuelve nada, no hay vínculo para reclamar', async () => {
    const { deviceLinkRouter } = await import('../modules/auth/deviceLink');
    const handler = getHandler(deviceLinkRouter, 'get', '/:linkId/claim');
    mockGetdel.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { linkId: 'abc' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('claim rechaza si el vínculo es de otra cuenta', async () => {
    const { deviceLinkRouter } = await import('../modules/auth/deviceLink');
    const handler = getHandler(deviceLinkRouter, 'get', '/:linkId/claim');
    mockGetdel.mockResolvedValue(JSON.stringify({ userId: 'user-otro', status: 'delivered', ciphertext: 'x', nonce: 'y', senderPublicKey: 'z' }));

    const req: any = { userId: 'user1', params: { linkId: 'abc' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('claim devuelve el blob cifrado una sola vez para que el dispositivo nuevo lo descifre localmente', async () => {
    const { deviceLinkRouter } = await import('../modules/auth/deviceLink');
    const handler = getHandler(deviceLinkRouter, 'get', '/:linkId/claim');
    mockGetdel.mockResolvedValue(JSON.stringify({
      userId: 'user1', status: 'delivered', ciphertext: 'blob-cifrado-real', nonce: 'nonce123', senderPublicKey: 'pub123'
    }));

    const req: any = { userId: 'user1', params: { linkId: 'abc' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ ciphertext: 'blob-cifrado-real', nonce: 'nonce123', senderPublicKey: 'pub123' });
    expect(mockGetdel).toHaveBeenCalledTimes(1);
  });
});
