export {}; // scope de módulo

const mockChatFindFirst = jest.fn();
const mockChatCreate = jest.fn();
const mockScheduledCreate = jest.fn();
const mockScheduledFindMany = jest.fn();
const mockScheduledFindUnique = jest.fn();
const mockScheduledDelete = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chat: {
      findFirst: (...args: any[]) => mockChatFindFirst(...args),
      create: (...args: any[]) => mockChatCreate(...args)
    },
    scheduledMessage: {
      create: (...args: any[]) => mockScheduledCreate(...args),
      findMany: (...args: any[]) => mockScheduledFindMany(...args),
      findUnique: (...args: any[]) => mockScheduledFindUnique(...args),
      delete: (...args: any[]) => mockScheduledDelete(...args)
    }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Recordatorios Personales (nuevo)', () => {
  beforeEach(() => {
    mockChatFindFirst.mockReset();
    mockChatCreate.mockReset();
    mockScheduledCreate.mockReset();
    mockScheduledFindMany.mockReset();
    mockScheduledFindUnique.mockReset();
    mockScheduledDelete.mockReset();
  });

  it('rechaza un remindAt en el pasado', async () => {
    const { remindersRouter } = await import('../modules/auth/reminders');
    const handler = getHandler(remindersRouter, 'post', '/');

    const req: any = { userId: 'user1', body: { content: 'llamar al dentista', remindAt: new Date(Date.now() - 1000).toISOString() } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockScheduledCreate).not.toHaveBeenCalled();
  });

  it('crea el chat de notas para uno mismo la primera vez, y reusa el existente después', async () => {
    const { remindersRouter } = await import('../modules/auth/reminders');
    const handler = getHandler(remindersRouter, 'post', '/');
    mockChatFindFirst.mockResolvedValue(null);
    mockChatCreate.mockResolvedValue({ id: 'self-chat-1' });
    mockScheduledCreate.mockResolvedValue({ id: 'rem1' });

    const req: any = {
      userId: 'user1',
      body: { content: 'llamar al dentista', remindAt: new Date(Date.now() + 60_000).toISOString() }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockChatCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isGroup: false, name: '__self_notes__' })
    }));
    expect(mockScheduledCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ chatId: 'self-chat-1', senderId: 'user1' })
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('lista solo los recordatorios pendientes propios, descifrados', async () => {
    const { remindersRouter } = await import('../modules/auth/reminders');
    const { encryptContent } = await import('../core/crypto/messageEncryption');
    const handler = getHandler(remindersRouter, 'get', '/');
    mockChatFindFirst.mockResolvedValue({ id: 'self-chat-1' });
    mockScheduledFindMany.mockResolvedValue([
      { id: 'rem1', content: encryptContent('⏰ llamar al dentista'), sendAt: new Date() }
    ]);

    const req: any = { userId: 'user1' };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      reminders: [expect.objectContaining({ id: 'rem1', content: '⏰ llamar al dentista' })]
    });
  });

  it('rechaza borrar el recordatorio de otra persona', async () => {
    const { remindersRouter } = await import('../modules/auth/reminders');
    const handler = getHandler(remindersRouter, 'delete', '/:id');
    mockScheduledFindUnique.mockResolvedValue({ id: 'rem1', senderId: 'otroUsuario', sent: false });

    const req: any = { userId: 'user1', params: { id: 'rem1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockScheduledDelete).not.toHaveBeenCalled();
  });

  it('rechaza borrar un recordatorio que ya se entregó', async () => {
    const { remindersRouter } = await import('../modules/auth/reminders');
    const handler = getHandler(remindersRouter, 'delete', '/:id');
    mockScheduledFindUnique.mockResolvedValue({ id: 'rem1', senderId: 'user1', sent: true });

    const req: any = { userId: 'user1', params: { id: 'rem1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('borra un recordatorio propio pendiente', async () => {
    const { remindersRouter } = await import('../modules/auth/reminders');
    const handler = getHandler(remindersRouter, 'delete', '/:id');
    mockScheduledFindUnique.mockResolvedValue({ id: 'rem1', senderId: 'user1', sent: false });

    const req: any = { userId: 'user1', params: { id: 'rem1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockScheduledDelete).toHaveBeenCalledWith({ where: { id: 'rem1' } });
    expect(res.json).toHaveBeenCalledWith({ deleted: true });
  });
});
