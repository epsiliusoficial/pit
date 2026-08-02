export {}; // scope de módulo propio

const mockUpsert = jest.fn();
jest.mock('../core/database/client', () => ({
  prisma: { focusMode: { upsert: (...args: any[]) => mockUpsert(...args) } }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Modo Concentración — validación de durationMinutes/allowedUserIds (bug real corregido)', () => {
  beforeEach(() => mockUpsert.mockReset());

  it('rechaza durationMinutes negativo (antes creaba una fecha de fin en el pasado sin avisar)', async () => {
    const { focusRouter } = await import('../modules/social/focus');
    const handler = getHandler(focusRouter, 'post', '/enable');
    const req: any = { userId: 'u1', body: { durationMinutes: -5 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('rechaza durationMinutes no numérico (antes tiraba un 500 al llegar a Prisma con Invalid Date)', async () => {
    const { focusRouter } = await import('../modules/social/focus');
    const handler = getHandler(focusRouter, 'post', '/enable');
    const req: any = { userId: 'u1', body: { durationMinutes: 'para-siempre' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza durationMinutes por encima del máximo (7 días)', async () => {
    const { focusRouter } = await import('../modules/social/focus');
    const handler = getHandler(focusRouter, 'post', '/enable');
    const req: any = { userId: 'u1', body: { durationMinutes: 999999 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza allowedUserIds que no es una lista de strings', async () => {
    const { focusRouter } = await import('../modules/social/focus');
    const handler = getHandler(focusRouter, 'post', '/enable');
    const req: any = { userId: 'u1', body: { allowedUserIds: 'no-es-una-lista' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('acepta una duración válida', async () => {
    mockUpsert.mockResolvedValue({ isEnabled: true });
    const { focusRouter } = await import('../modules/social/focus');
    const handler = getHandler(focusRouter, 'post', '/enable');
    const req: any = { userId: 'u1', body: { durationMinutes: 60 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    expect(mockUpsert).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(400);
  });
});
