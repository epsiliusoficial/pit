export {}; // scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));
jest.mock('../modules/social/achievements', () => ({ registerActivity: jest.fn(), BADGES: {} }));

const mockChatUserFindUnique = jest.fn();
const mockMessageFindMany = jest.fn();
const mockMessageCreate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    message: {
      findMany: (...args: any[]) => mockMessageFindMany(...args),
      create: (...args: any[]) => mockMessageCreate(...args)
    }
  }
}));

// callOpenAI real (no mockeado a nivel de módulo) haría un fetch real a
// OpenAI — lo interceptamos mockeando el global fetch en vez del módulo,
// así probamos también que /ask arma el prompt con transcript real.
const originalFetch = global.fetch;

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema "Pit AI" — asistente dentro del chat (nuevo)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockMessageFindMany.mockReset();
    mockMessageCreate.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rechaza si la pregunta está vacía', async () => {
    const { aiRouter } = await import('../modules/ai/controller');
    const handler = getHandler(aiRouter, 'post', '/ask/:chatId');

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, body: { question: '   ' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza si no sos miembro del chat', async () => {
    const { aiRouter } = await import('../modules/ai/controller');
    const handler = getHandler(aiRouter, 'post', '/ask/:chatId');
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, body: { question: '¿qué quedamos?' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it('responde usando el historial real y publica la respuesta como mensaje del chat', async () => {
    const { aiRouter } = await import('../modules/ai/controller');
    const { encryptContent } = await import('../core/crypto/messageEncryption');
    const handler = getHandler(aiRouter, 'post', '/ask/:chatId');

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockMessageFindMany.mockResolvedValue([
      { sender: { name: 'Ana' }, content: encryptContent('quedamos el sábado a las 5') }
    ]);
    mockMessageCreate.mockResolvedValue({ id: 'ans1', chatId: 'chatA' });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Quedaron el sábado a las 5.' } }] })
    }) as any;

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, body: { question: '¿cuándo quedamos?' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(global.fetch).toHaveBeenCalled();
    const fetchBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(fetchBody.messages[1].content).toContain('quedamos el sábado a las 5');
    expect(fetchBody.messages[1].content).toContain('¿cuándo quedamos?');

    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contentType: 'SYSTEM' }) })
    );
    expect(res.json).toHaveBeenCalledWith({ answer: 'Quedaron el sábado a las 5.' });
  });

  it('devuelve 502 si la API de IA falla, sin publicar ningún mensaje', async () => {
    const { aiRouter } = await import('../modules/ai/controller');
    const handler = getHandler(aiRouter, 'post', '/ask/:chatId');

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockMessageFindMany.mockResolvedValue([]);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }) as any;

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, body: { question: 'hola' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });
});
