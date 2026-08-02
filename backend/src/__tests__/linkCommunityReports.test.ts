export {}; // scope de módulo

const mockReportFindFirst = jest.fn();
const mockReportCreate = jest.fn();
const mockReportCount = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    report: {
      findFirst: (...args: any[]) => mockReportFindFirst(...args),
      create: (...args: any[]) => mockReportCreate(...args),
      count: (...args: any[]) => mockReportCount(...args)
    }
  }
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Reputación Comunitaria de Enlaces (nuevo)', () => {
  beforeEach(() => {
    mockReportFindFirst.mockReset();
    mockReportCreate.mockReset();
    mockReportCount.mockReset();
  });

  it('rechaza reportar una URL inválida', async () => {
    const { linkReportsRouter } = await import('../modules/links/communityReports');
    const handler = getHandler(linkReportsRouter, '/report');

    const req: any = { userId: 'user1', body: { url: 'no-es-una-url' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockReportCreate).not.toHaveBeenCalled();
  });

  it('rechaza reportar el mismo dominio dos veces desde el mismo usuario', async () => {
    const { linkReportsRouter } = await import('../modules/links/communityReports');
    const handler = getHandler(linkReportsRouter, '/report');
    mockReportFindFirst.mockResolvedValue({ id: 'r1' });

    const req: any = { userId: 'user1', body: { url: 'https://estafa-total.com/promo' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockReportCreate).not.toHaveBeenCalled();
  });

  it('registra el reporte y marca communityFlagged al llegar al umbral', async () => {
    const { linkReportsRouter } = await import('../modules/links/communityReports');
    const handler = getHandler(linkReportsRouter, '/report');
    mockReportFindFirst.mockResolvedValue(null);
    mockReportCreate.mockResolvedValue({ id: 'r1' });
    mockReportCount.mockResolvedValue(3);

    const req: any = { userId: 'user1', body: { url: 'https://estafa-total.com/promo' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockReportCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reporterId: 'user1', reportedId: 'link:estafa-total.com' })
    }));
    expect(res.json).toHaveBeenCalledWith({ domain: 'estafa-total.com', reportCount: 3, communityFlagged: true });
  });

  it('el chequeo combinado marca isSuspicious si la comunidad lo flaggeó, aunque la heurística no diga nada', async () => {
    const { linkReportsRouter } = await import('../modules/links/communityReports');
    const handler = getHandler(linkReportsRouter, '/check');
    mockReportCount.mockResolvedValue(5);

    const req: any = { userId: 'user1', query: { url: 'https://un-dominio-cualquiera-legitimo.com' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.communityFlagged).toBe(true);
    expect(result.isSuspicious).toBe(true);
    expect(result.reportCount).toBe(5);
  });

  it('el chequeo combinado sigue funcionando (sin flag) para un dominio sin reportes', async () => {
    const { linkReportsRouter } = await import('../modules/links/communityReports');
    const handler = getHandler(linkReportsRouter, '/check');
    mockReportCount.mockResolvedValue(0);

    const req: any = { userId: 'user1', query: { url: 'https://google.com' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result.communityFlagged).toBe(false);
    expect(result.isSuspicious).toBe(false);
  });
});
