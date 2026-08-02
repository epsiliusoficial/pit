export {}; // scope de módulo propio

const mockMessageFindUnique = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockMessageCreate = jest.fn();
const mockEmit = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    message: {
      findUnique: (...args: any[]) => mockMessageFindUnique(...args),
      create: (...args: any[]) => mockMessageCreate(...args)
    },
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) }
  }
}));
jest.mock('../index', () => ({ io: { to: () => ({ emit: mockEmit }) } }));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema "Reenviado Muchas Veces" (nuevo, alerta de cadena tipo WhatsApp)', () => {
  beforeEach(() => {
    mockMessageFindUnique.mockReset();
    mockChatUserFindUnique.mockReset();
    mockMessageCreate.mockReset();
    mockEmit.mockClear();
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockMessageCreate.mockImplementation(async ({ data }: any) => ({ id: 'fwd1', ...data }));
  });

  it('arranca el contador en 1 la primera vez que se reenvía un mensaje original', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/forward/:id');
    mockMessageFindUnique.mockResolvedValue({
      id: 'm1', content: 'cifrado', contentType: 'TEXT', metadata: null, forwardedFrom: null, senderId: 'userX'
    });

    const req: any = { userId: 'user1', params: { id: 'm1' }, body: { toChatId: 'chatB' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const createdData = mockMessageCreate.mock.calls[0][0].data;
    expect(createdData.metadata).toEqual({ forwardCount: 1, frequentlyForwarded: false });
  });

  it('sigue sumando el contador real en cadena, no reinicia en cada reenvío', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/forward/:id');
    mockMessageFindUnique.mockResolvedValue({
      id: 'm2', content: 'cifrado', contentType: 'TEXT',
      metadata: { forwardCount: 3, frequentlyForwarded: false }, forwardedFrom: 'userX', senderId: 'userY'
    });

    const req: any = { userId: 'user1', params: { id: 'm2' }, body: { toChatId: 'chatB' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const createdData = mockMessageCreate.mock.calls[0][0].data;
    expect(createdData.metadata).toEqual({ forwardCount: 4, frequentlyForwarded: false });
  });

  it('marca frequentlyForwarded:true a partir del quinto reenvío en cadena', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/forward/:id');
    mockMessageFindUnique.mockResolvedValue({
      id: 'm3', content: 'cifrado', contentType: 'TEXT',
      metadata: { forwardCount: 4 }, forwardedFrom: 'userX', senderId: 'userY'
    });

    const req: any = { userId: 'user1', params: { id: 'm3' }, body: { toChatId: 'chatB' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const createdData = mockMessageCreate.mock.calls[0][0].data;
    expect(createdData.metadata).toEqual({ forwardCount: 5, frequentlyForwarded: true });
  });

  it('rechaza reenviar a un chat del que no sos miembro', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/forward/:id');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', content: 'c', contentType: 'TEXT', metadata: null, senderId: 'x' });
    mockChatUserFindUnique.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { id: 'm1' }, body: { toChatId: 'chatB' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });
});
