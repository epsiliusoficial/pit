export {}; // scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserFindMany = jest.fn();
const mockChatFindFirst = jest.fn();
const mockChatCreate = jest.fn();
const mockMessageCreate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      update: (...args: any[]) => mockUserUpdate(...args),
      findMany: (...args: any[]) => mockUserFindMany(...args)
    },
    chat: {
      findFirst: (...args: any[]) => mockChatFindFirst(...args),
      create: (...args: any[]) => mockChatCreate(...args)
    },
    message: { create: (...args: any[]) => mockMessageCreate(...args) }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Botón de Emergencia SOS (nuevo)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset();
    mockUserFindMany.mockReset();
    mockChatFindFirst.mockReset();
    mockChatCreate.mockReset();
    mockMessageCreate.mockReset();
  });

  it('rechaza configurar contactos si te incluís a vos mismo', async () => {
    const { sosRouter } = await import('../modules/auth/sos');
    const handler = getHandler(sosRouter, 'post', '/contacts');

    const req: any = { userId: 'user1', body: { contactUserIds: ['user1', 'g2'] } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza configurar más del máximo de contactos', async () => {
    const { sosRouter } = await import('../modules/auth/sos');
    const handler = getHandler(sosRouter, 'post', '/contacts');

    const req: any = { userId: 'user1', body: { contactUserIds: Array.from({ length: 11 }, (_, i) => `c${i}`) } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('configura contactos de emergencia correctamente', async () => {
    const { sosRouter } = await import('../modules/auth/sos');
    const handler = getHandler(sosRouter, 'post', '/contacts');
    mockUserFindMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
    mockUserFindUnique.mockResolvedValue({ settings: {} });

    const req: any = { userId: 'user1', body: { contactUserIds: ['g1', 'g2'] } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { settings: { emergencyContacts: ['g1', 'g2'] } }
    });
  });

  it('rechaza disparar el SOS sin contactos de emergencia configurados', async () => {
    const { sosRouter } = await import('../modules/auth/sos');
    const handler = getHandler(sosRouter, 'post', '/trigger');
    mockUserFindUnique.mockResolvedValue({ id: 'user1', name: 'Ana', settings: {} });

    const req: any = { userId: 'user1', body: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it('dispara el SOS avisando a todos los contactos, con ubicación si se manda', async () => {
    const { sosRouter } = await import('../modules/auth/sos');
    const handler = getHandler(sosRouter, 'post', '/trigger');
    mockUserFindUnique.mockResolvedValue({ id: 'user1', name: 'Ana', settings: { emergencyContacts: ['g1', 'g2'] } });
    mockChatFindFirst.mockResolvedValue(null);
    mockChatCreate.mockResolvedValue({ id: 'chatNuevo' });
    mockMessageCreate.mockResolvedValue({ id: 'msg1' });

    const req: any = { userId: 'user1', body: { latitude: -34.6, longitude: -58.4 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatCreate).toHaveBeenCalledTimes(2);
    expect(mockMessageCreate).toHaveBeenCalledTimes(2);
    const firstCallContent = mockMessageCreate.mock.calls[0][0].data.content;
    expect(typeof firstCallContent).toBe('string');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ triggered: true, contactsNotified: 2 }));
  });

  it('reusa un chat directo existente en vez de crear uno nuevo', async () => {
    const { sosRouter } = await import('../modules/auth/sos');
    const handler = getHandler(sosRouter, 'post', '/trigger');
    mockUserFindUnique.mockResolvedValue({ id: 'user1', name: 'Ana', settings: { emergencyContacts: ['g1'] } });
    mockChatFindFirst.mockResolvedValue({ id: 'chatExistente' });
    mockMessageCreate.mockResolvedValue({ id: 'msg1' });

    const req: any = { userId: 'user1', body: {} };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ chatIds: ['chatExistente'] }));
  });
});
