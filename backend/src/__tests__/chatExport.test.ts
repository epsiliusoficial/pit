export {}; // scope de módulo

const mockChatUserFindUnique = jest.fn();
const mockChatFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    chat: { findUnique: (...args: any[]) => mockChatFindUnique(...args) }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    setHeader: jest.fn(),
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis()
  } as any;
}

describe('Sistema de Exportar Conversación — migrado a líneas del cliente (E2E real)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockChatFindUnique.mockReset();
  });

  it('rechaza exportar sin mandar las líneas ya descifradas por el cliente', async () => {
    const { chatExportRouter } = await import('../modules/chat/export');
    const handler = getHandler(chatExportRouter, 'post', '/:chatId');

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, query: {}, body: {} };
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('rechaza exportar un chat si no sos miembro', async () => {
    const { chatExportRouter } = await import('../modules/chat/export');
    const handler = getHandler(chatExportRouter, 'post', '/:chatId');
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, query: {}, body: { lines: [] } };
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('exporta en texto plano las líneas que manda el cliente', async () => {
    const { chatExportRouter } = await import('../modules/chat/export');
    const handler = getHandler(chatExportRouter, 'post', '/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', name: 'Amigos', isGroup: true });

    const req: any = {
      userId: 'user1', params: { chatId: 'chatA' }, query: {},
      body: { lines: [{ when: '30/7/2026 10:00', sender: 'Ana', body: 'hola a todos' }] }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
    expect(res.send.mock.calls[0][0]).toContain('hola a todos');
    expect(res.send.mock.calls[0][0]).toContain('Ana');
  });

  it('exporta en HTML escapando el contenido para evitar inyección', async () => {
    const { chatExportRouter } = await import('../modules/chat/export');
    const handler = getHandler(chatExportRouter, 'post', '/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', name: 'Amigos', isGroup: true });

    const req: any = {
      userId: 'user1', params: { chatId: 'chatA' }, query: { format: 'html' },
      body: { lines: [{ when: '30/7/2026 10:00', sender: 'Ana', body: '<script>alert(1)</script>' }] }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
    const body = res.send.mock.calls[0][0];
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;');
  });

  it('devuelve 404 si el chat no existe', async () => {
    const { chatExportRouter } = await import('../modules/chat/export');
    const handler = getHandler(chatExportRouter, 'post', '/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, query: {}, body: { lines: [] } };
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
