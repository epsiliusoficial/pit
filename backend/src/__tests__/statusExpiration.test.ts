export {}; // fuerza scope de módulo

const mockStatusFindUnique = jest.fn();
const mockStatusUpdate = jest.fn();
const mockContactFindUnique = jest.fn();
const mockBlockFindFirst = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    status: {
      findUnique: (...args: any[]) => mockStatusFindUnique(...args),
      update: (...args: any[]) => mockStatusUpdate(...args)
    },
    contact: { findUnique: (...args: any[]) => mockContactFindUnique(...args) },
    block: { findFirst: (...args: any[]) => mockBlockFindFirst(...args) }
  }
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Estados — chequeo de expiración agregado', () => {
  beforeEach(() => {
    mockStatusFindUnique.mockReset();
    mockStatusUpdate.mockReset();
    mockContactFindUnique.mockReset();
    mockBlockFindFirst.mockReset();
  });

  it('rechaza marcar como visto un estado ya expirado', async () => {
    const { statusRouter } = await import('../modules/social/status');
    const handler = getHandler(statusRouter, '/:id/view');

    mockStatusFindUnique.mockResolvedValue({
      id: 'status1',
      userId: 'user1',
      expiresAt: new Date(Date.now() - 1000),
      viewedBy: []
    });

    const req: any = { userId: 'user1', params: { id: 'status1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(mockStatusUpdate).not.toHaveBeenCalled();
  });

  it('permite al dueño marcar como visto su propio estado todavía vigente', async () => {
    const { statusRouter } = await import('../modules/social/status');
    const handler = getHandler(statusRouter, '/:id/view');

    mockStatusFindUnique.mockResolvedValue({
      id: 'status1',
      userId: 'user1',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      viewedBy: []
    });
    mockStatusUpdate.mockResolvedValue({});

    const req: any = { userId: 'user1', params: { id: 'status1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockStatusUpdate).toHaveBeenCalled();
  });

  it('permite a un contacto sin bloqueo mutuo marcar como visto el estado de otro', async () => {
    const { statusRouter } = await import('../modules/social/status');
    const handler = getHandler(statusRouter, '/:id/view');

    mockStatusFindUnique.mockResolvedValue({
      id: 'status1',
      userId: 'dueño',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      viewedBy: []
    });
    mockContactFindUnique.mockResolvedValue({ ownerId: 'user1', contactId: 'dueño' });
    mockBlockFindFirst.mockResolvedValue(null);
    mockStatusUpdate.mockResolvedValue({});

    const req: any = { userId: 'user1', params: { id: 'status1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockStatusUpdate).toHaveBeenCalled();
  });

  it('bloqueo real corregido: rechaza marcar visto si hay bloqueo mutuo entre viewer y dueño', async () => {
    const { statusRouter } = await import('../modules/social/status');
    const handler = getHandler(statusRouter, '/:id/view');

    mockStatusFindUnique.mockResolvedValue({
      id: 'status1',
      userId: 'dueño',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      viewedBy: []
    });
    mockContactFindUnique.mockResolvedValue({ ownerId: 'user1', contactId: 'dueño' });
    mockBlockFindFirst.mockResolvedValue({ blockerId: 'dueño', blockedId: 'user1' });

    const req: any = { userId: 'user1', params: { id: 'status1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockStatusUpdate).not.toHaveBeenCalled();
  });

  it('rechaza marcar visto un estado de alguien que no es contacto', async () => {
    const { statusRouter } = await import('../modules/social/status');
    const handler = getHandler(statusRouter, '/:id/view');

    mockStatusFindUnique.mockResolvedValue({
      id: 'status1',
      userId: 'desconocido',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      viewedBy: []
    });
    mockContactFindUnique.mockResolvedValue(null);
    mockBlockFindFirst.mockResolvedValue(null);

    const req: any = { userId: 'user1', params: { id: 'status1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockStatusUpdate).not.toHaveBeenCalled();
  });
});
