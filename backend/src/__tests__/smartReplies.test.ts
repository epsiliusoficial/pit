export {}; // fuerza scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockChatUserFindUnique = jest.fn();
const mockMessageFindFirst = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    message: { findFirst: (...args: any[]) => mockMessageFindFirst(...args) }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Respuestas Rápidas Inteligentes — sistema nuevo', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockMessageFindFirst.mockReset();
    (global as any).fetch = jest.fn();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('rechaza si el usuario no pertenece al chat', async () => {
    const { aiRouter } = await import('../modules/ai/controller');
    const handler = getHandler(aiRouter, 'get', '/smart-replies/:chatId');
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'atacante', params: { chatId: 'chatX' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockMessageFindFirst).not.toHaveBeenCalled();
  });

  it('devuelve suggestions: [] si no hay ningún mensaje del otro para responder', async () => {
    const { aiRouter } = await import('../modules/ai/controller');
    const handler = getHandler(aiRouter, 'get', '/smart-replies/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockMessageFindFirst.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ suggestions: [] });
  });

  it('busca el último mensaje de OTRO usuario, no los propios', async () => {
    const { aiRouter } = await import('../modules/ai/controller');
    const handler = getHandler(aiRouter, 'get', '/smart-replies/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockMessageFindFirst.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockMessageFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ senderId: { not: 'user1' } }) })
    );
  });

  it('parsea exactamente 3 sugerencias separadas por "|" desde la respuesta del modelo', async () => {
    const { aiRouter } = await import('../modules/ai/controller');
    const { encryptContent } = await import('../core/crypto/messageEncryption');
    const handler = getHandler(aiRouter, 'get', '/smart-replies/:chatId');

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockMessageFindFirst.mockResolvedValue({ content: encryptContent('¿Vamos al cine mañana?') });
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Dale! | No puedo | ¿A qué hora?' } }] })
    });

    const req: any = { userId: 'user1', params: { chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ suggestions: ['Dale!', 'No puedo', '¿A qué hora?'] });
  });

  it('devuelve 502 con mensaje claro si OpenAI falla, sin mock silencioso', async () => {
    const { aiRouter } = await import('../modules/ai/controller');
    const { encryptContent } = await import('../core/crypto/messageEncryption');
    const handler = getHandler(aiRouter, 'get', '/smart-replies/:chatId');

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockMessageFindFirst.mockResolvedValue({ content: encryptContent('hola') });
    (global.fetch as any).mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });

    const req: any = { userId: 'user1', params: { chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
  });
});
