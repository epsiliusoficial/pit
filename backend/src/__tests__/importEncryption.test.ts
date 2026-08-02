export {}; // fuerza scope de módulo

const mockChatUserFindUnique = jest.fn();
const mockMessageCreate = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    message: { create: (...args: any[]) => mockMessageCreate(...args) },
    $transaction: (...args: any[]) => mockTransaction(...args)
  }
}));
jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Importación de WhatsApp — cifrado real (último hueco encontrado y cerrado)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockMessageCreate.mockReset();
    mockTransaction.mockReset();
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
  });

  it('el content de los mensajes importados se cifra antes de guardarse', async () => {
    const { importRouter } = await import('../modules/import/controller');
    const handler = getHandler(importRouter, '/whatsapp');

    mockTransaction.mockImplementation(async (creates: any[]) => Promise.all(creates));
    mockMessageCreate.mockImplementation((args: any) => Promise.resolve({ id: 'msg1', ...args.data }));

    const plainText = '12/5/24, 14:30 - Juan: mensaje secreto del chat exportado';
    const req: any = {
      userId: 'user1',
      body: { chatId: 'chat1' },
      file: { buffer: Buffer.from(plainText, 'utf-8') }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await handler(req, res);

    expect(mockMessageCreate).toHaveBeenCalled();
    const savedContent = mockMessageCreate.mock.calls[0][0].data.content;
    expect(savedContent).toMatch(/^enc1:/);
    expect(savedContent).not.toContain('mensaje secreto');
  });
});
