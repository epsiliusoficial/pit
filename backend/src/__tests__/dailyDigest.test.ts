export {}; // scope de módulo

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockCallOpenAI = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      update: (...args: any[]) => mockUserUpdate(...args)
    }
  }
}));

jest.mock('../modules/ai/controller', () => ({ callOpenAI: (...args: any[]) => mockCallOpenAI(...args) }));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// Sistema "E2E real (fase 3)": ANTES el servidor recorría todos los chats y
// desciframba con su propia clave — imposible ahora (contenido cifrado E2E).
// El resumen sigue vivo: el CLIENTE arma el transcript con mensajes que YA
// descifró para mostrarlos en pantalla, y lo manda por POST. El GET solo
// sirve la caché o avisa que hace falta mandar el transcript.
describe('Sistema de Resumen Diario — migrado a transcript del cliente (E2E real)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset();
    mockCallOpenAI.mockReset();
  });

  it('GET devuelve el resumen cacheado si se pidió hace menos de 15 minutos', async () => {
    const { dailyDigestRouter } = await import('../modules/ai/dailyDigest');
    const handler = getHandler(dailyDigestRouter, 'get', '/');
    mockUserFindUnique.mockResolvedValue({
      settings: { lastDigest: { text: 'resumen de antes', generatedAt: new Date(Date.now() - 60_000).toISOString() } }
    });

    const req: any = { userId: 'user1' };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ digest: 'resumen de antes', cached: true }));
  });

  it('GET avisa que hace falta el transcript del cliente si no hay caché vigente', async () => {
    const { dailyDigestRouter } = await import('../modules/ai/dailyDigest');
    const handler = getHandler(dailyDigestRouter, 'get', '/');
    mockUserFindUnique.mockResolvedValue({ settings: {} });

    const req: any = { userId: 'user1' };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ needsTranscript: true }));
  });

  it('POST rechaza sin transcript', async () => {
    const { dailyDigestRouter } = await import('../modules/ai/dailyDigest');
    const handler = getHandler(dailyDigestRouter, 'post', '/');

    const req: any = { userId: 'user1', body: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCallOpenAI).not.toHaveBeenCalled();
  });

  it('POST genera el resumen a partir del transcript ya descifrado por el cliente, y cachea', async () => {
    const { dailyDigestRouter } = await import('../modules/ai/dailyDigest');
    const handler = getHandler(dailyDigestRouter, 'post', '/');
    mockUserFindUnique.mockResolvedValue({ settings: {} });
    mockCallOpenAI.mockResolvedValue('### Amigos\n- Plan para el sábado');

    const req: any = { userId: 'user1', body: { transcript: '### Amigos\nAna: vamos el sábado' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockCallOpenAI).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('vamos el sábado'));
    expect(mockUserUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user1' },
      data: expect.objectContaining({ settings: expect.objectContaining({ lastDigest: expect.any(Object) }) })
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ digest: '### Amigos\n- Plan para el sábado', cached: false }));
  });

  it('POST devuelve 502 si la IA falla, sin romper la caché anterior', async () => {
    const { dailyDigestRouter } = await import('../modules/ai/dailyDigest');
    const handler = getHandler(dailyDigestRouter, 'post', '/');
    mockUserFindUnique.mockResolvedValue({ settings: {} });
    mockCallOpenAI.mockRejectedValue(new Error('boom'));

    const req: any = { userId: 'user1', body: { transcript: 'Ana: hola' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
