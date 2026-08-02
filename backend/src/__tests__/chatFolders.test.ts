export {}; // scope de módulo

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockChatUserFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      update: (...args: any[]) => mockUserUpdate(...args)
    },
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Carpetas de Chats — sistema nuevo (organización personal)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset();
    mockChatUserFindUnique.mockReset();
  });

  it('rechaza sumar un chat del que el usuario no es miembro', async () => {
    const { folderRouter } = await import('../modules/chat/folders');
    const handler = getHandler(folderRouter, 'post', '/:folderName/chats/:chatId');
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'atacante', params: { folderName: 'Trabajo', chatId: 'chatAjeno' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('rechaza nombres de carpeta vacíos o demasiado largos', async () => {
    const { folderRouter } = await import('../modules/chat/folders');
    const handler = getHandler(folderRouter, 'post', '/:folderName');

    const req: any = { userId: 'user1', params: { folderName: 'x'.repeat(31) } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('crea la carpeta y suma el chat si el usuario es miembro real', async () => {
    const { folderRouter } = await import('../modules/chat/folders');
    const handler = getHandler(folderRouter, 'post', '/:folderName/chats/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockUserFindUnique.mockResolvedValue({ settings: {} });

    const req: any = { userId: 'user1', params: { folderName: 'Trabajo', chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { settings: { chatFolders: { Trabajo: ['chatA'] } } } })
    );
    expect(res.json).toHaveBeenCalledWith({ folders: { Trabajo: ['chatA'] } });
  });

  it('no duplica un chat que ya está en la carpeta', async () => {
    const { folderRouter } = await import('../modules/chat/folders');
    const handler = getHandler(folderRouter, 'post', '/:folderName/chats/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockUserFindUnique.mockResolvedValue({ settings: { chatFolders: { Trabajo: ['chatA'] } } });

    const req: any = { userId: 'user1', params: { folderName: 'Trabajo', chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ folders: { Trabajo: ['chatA'] } });
  });

  it('quitar un chat de una carpeta no afecta las demás carpetas', async () => {
    const { folderRouter } = await import('../modules/chat/folders');
    const handler = getHandler(folderRouter, 'delete', '/:folderName/chats/:chatId');
    mockUserFindUnique.mockResolvedValue({ settings: { chatFolders: { Trabajo: ['chatA', 'chatB'], Familia: ['chatA'] } } });

    const req: any = { userId: 'user1', params: { folderName: 'Trabajo', chatId: 'chatA' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { settings: { chatFolders: { Trabajo: ['chatB'], Familia: ['chatA'] } } } })
    );
  });

  it('respeta el máximo de 20 carpetas', async () => {
    const { folderRouter } = await import('../modules/chat/folders');
    const handler = getHandler(folderRouter, 'post', '/:folderName');
    const yaLlenas: Record<string, string[]> = {};
    for (let i = 0; i < 20; i++) yaLlenas['F' + i] = [];
    mockUserFindUnique.mockResolvedValue({ settings: { chatFolders: yaLlenas } });

    const req: any = { userId: 'user1', params: { folderName: 'F21' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
