export {}; // scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockChatUserFindUnique = jest.fn();
const mockChatFindUnique = jest.fn();
const mockChatUpdate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    chat: {
      findUnique: (...args: any[]) => mockChatFindUnique(...args),
      update: (...args: any[]) => mockChatUpdate(...args)
    }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Notas Compartidas de Grupo (nuevo)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockChatFindUnique.mockReset();
    mockChatUpdate.mockReset();
  });

  it('devuelve una nota vacía por default si nunca se escribió nada', async () => {
    const { sharedNoteRouter } = await import('../modules/chat/sharedNote');
    const handler = getHandler(sharedNoteRouter, 'get', '/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatFindUnique.mockResolvedValue({ groupConfig: {} });

    const req: any = { userId: 'user1', params: { chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ content: '', updatedBy: null, updatedAt: null });
  });

  it('rechaza leer la nota si no sos miembro del chat', async () => {
    const { sharedNoteRouter } = await import('../modules/chat/sharedNote');
    const handler = getHandler(sharedNoteRouter, 'get', '/:chatId');
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rechaza guardar contenido demasiado largo', async () => {
    const { sharedNoteRouter } = await import('../modules/chat/sharedNote');
    const handler = getHandler(sharedNoteRouter, 'put', '/:chatId');

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, body: { content: 'x'.repeat(5001) } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('cualquier miembro puede editar la nota compartida, última edición gana', async () => {
    const { sharedNoteRouter } = await import('../modules/chat/sharedNote');
    const handler = getHandler(sharedNoteRouter, 'put', '/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatFindUnique.mockResolvedValue({ groupConfig: { pinnedMessages: ['m1'] } });

    const req: any = { userId: 'user2', params: { chatId: 'chatA' }, body: { content: 'Traer bebidas para la reunión' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatUpdate).toHaveBeenCalledWith({
      where: { id: 'chatA' },
      data: {
        groupConfig: expect.objectContaining({
          pinnedMessages: ['m1'],
          sharedNote: expect.objectContaining({ content: 'Traer bebidas para la reunión', updatedBy: 'user2' })
        })
      }
    });
  });
});
