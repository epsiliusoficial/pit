export {}; // scope de módulo propio

const mockReportCreate = jest.fn();
const mockReportFindFirst = jest.fn();
const mockReportUpdate = jest.fn();
const mockUserFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    report: {
      create: (...args: any[]) => mockReportCreate(...args),
      findFirst: (...args: any[]) => mockReportFindFirst(...args),
      update: (...args: any[]) => mockReportUpdate(...args)
    },
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de reportes — validación, anti-spam y resolución estricta', () => {
  beforeEach(() => {
    mockReportCreate.mockReset();
    mockReportFindFirst.mockReset();
    mockReportUpdate.mockReset();
    mockUserFindUnique.mockReset();
    mockUserFindUnique.mockResolvedValue({ id: 'victima' });
    mockReportFindFirst.mockResolvedValue(null);
  });

  it('rechaza reportarse a uno mismo', async () => {
    const { reportRouter } = await import('../modules/moderation/reports');
    const handler = getHandler(reportRouter, 'post', '/');

    const req: any = { userId: 'user-1', body: { reportedId: 'user-1', reason: 'test' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockReportCreate).not.toHaveBeenCalled();
  });

  it('rechaza un reason demasiado largo', async () => {
    const { reportRouter } = await import('../modules/moderation/reports');
    const handler = getHandler(reportRouter, 'post', '/');

    const req: any = { userId: 'user-1', body: { reportedId: 'victima', reason: 'x'.repeat(1001) } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockReportCreate).not.toHaveBeenCalled();
  });

  it('rechaza reportar a un usuario que no existe', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const { reportRouter } = await import('../modules/moderation/reports');
    const handler = getHandler(reportRouter, 'post', '/');

    const req: any = { userId: 'user-1', body: { reportedId: 'no-existe', reason: 'test' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('anti-spam: devuelve el reporte existente en vez de duplicarlo', async () => {
    mockReportFindFirst.mockResolvedValue({ id: 'reporte-existente', status: 'PENDING' });
    const { reportRouter } = await import('../modules/moderation/reports');
    const handler = getHandler(reportRouter, 'post', '/');

    const req: any = { userId: 'user-1', body: { reportedId: 'victima', reason: 'test' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockReportCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ id: 'reporte-existente', status: 'PENDING' });
  });

  it('resolve rechaza un action que no sea REVIEWED/DISMISSED (antes caía en DISMISSED silenciosamente)', async () => {
    const { reportRouter } = await import('../modules/moderation/reports');
    const handler = getHandler(reportRouter, 'post', '/:id/resolve');

    const req: any = { params: { id: 'r1' }, body: { action: 'REVIEWD' }, headers: { 'x-admin-secret': 'secreto' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    process.env.ADMIN_SECRET = 'secreto';
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockReportUpdate).not.toHaveBeenCalled();
  });
});
