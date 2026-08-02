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

describe('Sistema de Interruptor de Hombre Muerto (nuevo)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset();
    mockUserFindMany.mockReset();
    mockChatFindFirst.mockReset();
    mockChatCreate.mockReset();
    mockMessageCreate.mockReset();
  });

  it('rechaza activar sin contacto de confianza', async () => {
    const { deadManSwitchRouter } = await import('../modules/auth/deadManSwitch');
    const handler = getHandler(deadManSwitchRouter, 'post', '/');

    const req: any = { userId: 'user1', body: { enabled: true, daysInactive: 30 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza si el contacto de confianza sos vos mismo', async () => {
    const { deadManSwitchRouter } = await import('../modules/auth/deadManSwitch');
    const handler = getHandler(deadManSwitchRouter, 'post', '/');

    const req: any = { userId: 'user1', body: { enabled: true, daysInactive: 30, trustedContactUserId: 'user1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza un daysInactive fuera de rango', async () => {
    const { deadManSwitchRouter } = await import('../modules/auth/deadManSwitch');
    const handler = getHandler(deadManSwitchRouter, 'post', '/');

    const req: any = { userId: 'user1', body: { enabled: true, daysInactive: 9999, trustedContactUserId: 'user2' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('activa correctamente guardando la configuración', async () => {
    const { deadManSwitchRouter } = await import('../modules/auth/deadManSwitch');
    const handler = getHandler(deadManSwitchRouter, 'post', '/');
    mockUserFindUnique
      .mockResolvedValueOnce({ id: 'user2' }) // existe el contacto
      .mockResolvedValueOnce({ settings: { theme: 'dark' } }); // yo

    const req: any = { userId: 'user1', body: { enabled: true, daysInactive: 30, trustedContactUserId: 'user2' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: {
        settings: {
          theme: 'dark',
          deadManSwitch: { enabled: true, daysInactive: 30, trustedContactUserId: 'user2', triggered: false }
        }
      }
    });
  });

  it('el worker NO dispara si el usuario estuvo activo hace poco', async () => {
    const { checkDeadManSwitches } = await import('../modules/auth/deadManSwitch');
    mockUserFindMany.mockResolvedValue([
      {
        id: 'user1', name: 'Ana', lastSeen: new Date(), createdAt: new Date(),
        settings: { deadManSwitch: { enabled: true, daysInactive: 30, trustedContactUserId: 'user2', triggered: false } }
      }
    ]);

    await checkDeadManSwitches();

    expect(mockMessageCreate).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('el worker dispara el aviso si pasó el tiempo de inactividad configurado', async () => {
    const { checkDeadManSwitches } = await import('../modules/auth/deadManSwitch');
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    mockUserFindMany.mockResolvedValue([
      {
        id: 'user1', name: 'Ana', lastSeen: oldDate, createdAt: oldDate,
        settings: { deadManSwitch: { enabled: true, daysInactive: 30, trustedContactUserId: 'user2', triggered: false } }
      }
    ]);
    mockChatFindFirst.mockResolvedValue(null);
    mockChatCreate.mockResolvedValue({ id: 'chatNuevo' });
    mockMessageCreate.mockResolvedValue({ id: 'msg1' });

    await checkDeadManSwitches();

    expect(mockChatCreate).toHaveBeenCalled();
    expect(mockMessageCreate).toHaveBeenCalled();
    expect(mockUserUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user1' },
      data: expect.objectContaining({
        settings: expect.objectContaining({
          deadManSwitch: expect.objectContaining({ triggered: true })
        })
      })
    }));
  });

  it('el worker no dispara dos veces si ya está triggered', async () => {
    const { checkDeadManSwitches } = await import('../modules/auth/deadManSwitch');
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    mockUserFindMany.mockResolvedValue([
      {
        id: 'user1', name: 'Ana', lastSeen: oldDate, createdAt: oldDate,
        settings: { deadManSwitch: { enabled: true, daysInactive: 30, trustedContactUserId: 'user2', triggered: true } }
      }
    ]);

    await checkDeadManSwitches();

    expect(mockMessageCreate).not.toHaveBeenCalled();
  });
});
