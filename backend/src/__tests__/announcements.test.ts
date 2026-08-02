export {}; // scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockMessageFindUnique = jest.fn();
const mockMessageUpdate = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockChatUserFindMany = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    message: {
      findUnique: (...args: any[]) => mockMessageFindUnique(...args),
      update: (...args: any[]) => mockMessageUpdate(...args)
    },
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      findMany: (...args: any[]) => mockChatUserFindMany(...args)
    }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Anuncios con Confirmación Obligatoria (nuevo)', () => {
  beforeEach(() => {
    mockMessageFindUnique.mockReset();
    mockMessageUpdate.mockReset();
    mockChatUserFindUnique.mockReset();
    mockChatUserFindMany.mockReset();
  });

  it('rechaza pedir confirmación si no sos admin del grupo', async () => {
    const { announcementsRouter } = await import('../modules/chat/announcements');
    const handler = getHandler(announcementsRouter, 'post', '/:messageId/require-ack');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', chatId: 'chatA', isDeleted: false, metadata: null });
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { messageId: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockMessageUpdate).not.toHaveBeenCalled();
  });

  it('un admin marca el mensaje como anuncio con confirmación obligatoria', async () => {
    const { announcementsRouter } = await import('../modules/chat/announcements');
    const handler = getHandler(announcementsRouter, 'post', '/:messageId/require-ack');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', chatId: 'chatA', isDeleted: false, metadata: null });
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });

    const req: any = { userId: 'admin1', params: { messageId: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockMessageUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' }, data: { metadata: { requireAck: true, ackedBy: [] } }
    });
  });

  it('rechaza confirmar un mensaje que no requiere confirmación', async () => {
    const { announcementsRouter } = await import('../modules/chat/announcements');
    const handler = getHandler(announcementsRouter, 'post', '/:messageId/ack');
    mockMessageFindUnique.mockResolvedValue({ id: 'm1', chatId: 'chatA', isDeleted: false, metadata: null });
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { messageId: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('un miembro confirma la lectura, sin duplicarse si confirma dos veces', async () => {
    const { announcementsRouter } = await import('../modules/chat/announcements');
    const handler = getHandler(announcementsRouter, 'post', '/:messageId/ack');
    mockMessageFindUnique.mockResolvedValue({
      id: 'm1', chatId: 'chatA', isDeleted: false, metadata: { requireAck: true, ackedBy: ['user1'] }
    });
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });

    const req: any = { userId: 'user1', params: { messageId: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ ackedBy: ['user1'] });
  });

  it('el admin ve quién falta confirmar, comparado contra los miembros reales', async () => {
    const { announcementsRouter } = await import('../modules/chat/announcements');
    const handler = getHandler(announcementsRouter, 'get', '/:messageId/status');
    mockMessageFindUnique.mockResolvedValue({
      id: 'm1', chatId: 'chatA', isDeleted: false, metadata: { requireAck: true, ackedBy: ['user1'] }
    });
    mockChatUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockChatUserFindMany.mockResolvedValue([{ userId: 'user1' }, { userId: 'user2' }, { userId: 'user3' }]);

    const req: any = { userId: 'admin1', params: { messageId: 'm1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ acked: ['user1'], pending: ['user2', 'user3'], total: 3 });
  });
});
