export {}; // scope de módulo propio

const mockChatUserFindUnique = jest.fn();
const mockMessageCreate = jest.fn();
const mockTransaction = jest.fn();
const mockEmit = jest.fn();
const mockTo = jest.fn((_room: string) => ({ emit: mockEmit }));

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    message: { create: (...args: any[]) => mockMessageCreate(...args) },
    $transaction: (...args: any[]) => mockTransaction(...args)
  }
}));
jest.mock('../index', () => ({ io: { to: (room: string) => mockTo(room) } }));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Importación de WhatsApp — avisa a los demás miembros (bug real corregido: antes nadie se enteraba)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockMessageCreate.mockReset();
    mockTransaction.mockReset();
    mockEmit.mockClear();
    mockTo.mockClear();
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockTransaction.mockImplementation(async (creates: any[]) => Promise.all(creates));
    mockMessageCreate.mockImplementation((args: any) => Promise.resolve({ id: 'msg1', ...args.data }));
  });

  it('emite history_imported con el chatId y la cantidad importada, en vez de un evento por mensaje', async () => {
    const { importRouter } = await import('../modules/import/controller');
    const handler = getHandler(importRouter, '/whatsapp');

    const plainText = '12/5/24, 14:30 - Juan: hola\n12/5/24, 14:31 - Ana: qué tal';
    const req: any = {
      userId: 'user1',
      body: { chatId: 'chat1' },
      file: { buffer: Buffer.from(plainText, 'utf-8') }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await handler(req, res);

    expect(mockTo).toHaveBeenCalledWith('chat1');
    expect(mockEmit).toHaveBeenCalledWith('history_imported', { chatId: 'chat1', count: 2 });
    // Un solo evento total, no uno por mensaje importado.
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });
});
