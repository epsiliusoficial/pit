export {}; // scope de módulo

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockMessageFindUnique = jest.fn();
const mockCallOpenAI = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      update: (...args: any[]) => mockUserUpdate(...args)
    },
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    message: { findUnique: (...args: any[]) => mockMessageFindUnique(...args) }
  }
}));

jest.mock('../modules/ai/controller', () => ({ callOpenAI: (...args: any[]) => mockCallOpenAI(...args) }));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Traducción Automática de Chat (nuevo)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset();
    mockChatUserFindUnique.mockReset();
    mockMessageFindUnique.mockReset();
    mockCallOpenAI.mockReset();
  });

  it('devuelve deshabilitado por default si nunca se configuró', async () => {
    const { autoTranslateRouter } = await import('../modules/ai/autoTranslate');
    const handler = getHandler(autoTranslateRouter, 'get', '/');
    mockUserFindUnique.mockResolvedValue({ settings: {} });

    const req: any = { userId: 'user1' };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ enabled: false, targetLanguage: null });
  });

  it('rechaza activar sin especificar idioma', async () => {
    const { autoTranslateRouter } = await import('../modules/ai/autoTranslate');
    const handler = getHandler(autoTranslateRouter, 'post', '/');

    const req: any = { userId: 'user1', body: { enabled: true } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('guarda la preferencia sin pisar otras settings existentes', async () => {
    const { autoTranslateRouter } = await import('../modules/ai/autoTranslate');
    const handler = getHandler(autoTranslateRouter, 'post', '/');
    mockUserFindUnique.mockResolvedValue({ settings: { autoReply: { enabled: true, message: 'afk' } } });

    const req: any = { userId: 'user1', body: { enabled: true, targetLanguage: 'portugués' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: {
        settings: {
          autoReply: { enabled: true, message: 'afk' },
          autoTranslate: { enabled: true, targetLanguage: 'portugués' }
        }
      }
    });
    expect(res.json).toHaveBeenCalledWith({ enabled: true, targetLanguage: 'portugués' });
  });

  // Sistema "E2E real (fase 3)": ANTES este endpoint buscaba el mensaje en
  // la base y lo desciframba con la clave del servidor — imposible ahora
  // (contenido cifrado E2E). El cliente manda el texto que YA descifró
  // localmente para mostrarlo en pantalla.
  it('rechaza traducir sin mandar el plaintext ya descifrado por el cliente', async () => {
    const { autoTranslateRouter } = await import('../modules/ai/autoTranslate');
    const handler = getHandler(autoTranslateRouter, 'post', '/message/:chatId/:messageId');

    const req: any = { userId: 'user1', params: { chatId: 'chatA', messageId: 'm1' }, body: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCallOpenAI).not.toHaveBeenCalled();
  });

  it('rechaza traducir un mensaje si no tenés la traducción automática activada', async () => {
    const { autoTranslateRouter } = await import('../modules/ai/autoTranslate');
    const handler = getHandler(autoTranslateRouter, 'post', '/message/:chatId/:messageId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockUserFindUnique.mockResolvedValue({ settings: {} });

    const req: any = { userId: 'user1', params: { chatId: 'chatA', messageId: 'm1' }, body: { plaintext: 'hola' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCallOpenAI).not.toHaveBeenCalled();
  });

  it('rechaza traducir si no sos miembro del chat', async () => {
    const { autoTranslateRouter } = await import('../modules/ai/autoTranslate');
    const handler = getHandler(autoTranslateRouter, 'post', '/message/:chatId/:messageId');
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { chatId: 'chatA', messageId: 'm1' }, body: { plaintext: 'hola' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('traduce el plaintext que manda el cliente, usando el idioma guardado', async () => {
    const { autoTranslateRouter } = await import('../modules/ai/autoTranslate');
    const handler = getHandler(autoTranslateRouter, 'post', '/message/:chatId/:messageId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockUserFindUnique.mockResolvedValue({ settings: { autoTranslate: { enabled: true, targetLanguage: 'inglés' } } });
    mockCallOpenAI.mockResolvedValue('hello how are you');

    const req: any = { userId: 'user1', params: { chatId: 'chatA', messageId: 'm1' }, body: { plaintext: 'hola como estas' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockCallOpenAI).toHaveBeenCalledWith(expect.stringContaining('inglés'), 'hola como estas');
    expect(res.json).toHaveBeenCalledWith({
      original: 'hola como estas', translated: 'hello how are you', targetLanguage: 'inglés'
    });
  });
});
