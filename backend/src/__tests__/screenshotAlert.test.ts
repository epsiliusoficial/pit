export {}; // scope de módulo

const mockEmit = jest.fn();
jest.mock('../index', () => ({ io: { to: () => ({ emit: mockEmit }) } }));

const mockChatUserFindUnique = jest.fn();
const mockUserFindUnique = jest.fn();
const mockMessageCreate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) },
    message: { create: (...args: any[]) => mockMessageCreate(...args) }
  }
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Aviso de Captura de Pantalla (nuevo)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockUserFindUnique.mockReset();
    mockMessageCreate.mockReset();
    mockEmit.mockClear();
  });

  it('rechaza si no sos miembro del chat', async () => {
    const { screenshotAlertRouter } = await import('../modules/chat/screenshotAlert');
    const handler = getHandler(screenshotAlertRouter, '/:chatId');
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, body: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it('registra la captura, avisa por socket y publica un mensaje visible', async () => {
    const { screenshotAlertRouter } = await import('../modules/chat/screenshotAlert');
    const handler = getHandler(screenshotAlertRouter, '/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockUserFindUnique.mockResolvedValue({ name: 'Ana' });
    mockMessageCreate.mockResolvedValue({ id: 'msg1', chatId: 'chatA' });

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, body: { messageId: 'm-view-once' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contentType: 'SYSTEM' }) })
    );
    expect(mockEmit).toHaveBeenCalledWith('screenshot_taken', expect.objectContaining({
      chatId: 'chatA', userId: 'user1', messageId: 'm-view-once'
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
