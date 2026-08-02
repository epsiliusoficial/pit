export {}; // scope de módulo

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      update: (...args: any[]) => mockUserUpdate(...args)
    }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Código de Seguridad (nuevo, estilo Signal)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset();
  });

  it('el código de seguridad es el mismo sin importar quién de los dos lo pida', async () => {
    const { computeSafetyNumber } = await import('../modules/auth/safetyNumber');
    const codeAB = computeSafetyNumber('pubKeyA', 'pubKeyB');
    const codeBA = computeSafetyNumber('pubKeyB', 'pubKeyA');
    expect(codeAB).toBe(codeBA);
    expect(codeAB).toMatch(/^(\d{5} )+\d{5}$/);
  });

  it('da códigos distintos para pares de claves distintos', async () => {
    const { computeSafetyNumber } = await import('../modules/auth/safetyNumber');
    expect(computeSafetyNumber('pubKeyA', 'pubKeyB')).not.toBe(computeSafetyNumber('pubKeyA', 'pubKeyC'));
  });

  it('rechaza pedir el código de seguridad con uno mismo', async () => {
    const { safetyNumberRouter } = await import('../modules/auth/safetyNumber');
    const handler = getHandler(safetyNumberRouter, 'get', '/:otherUserId');

    const req: any = { userId: 'user1', params: { otherUserId: 'user1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('marca verified:false y keyChanged:false si nunca se verificó antes', async () => {
    const { safetyNumberRouter } = await import('../modules/auth/safetyNumber');
    const handler = getHandler(safetyNumberRouter, 'get', '/:otherUserId');
    mockUserFindUnique
      .mockResolvedValueOnce({ publicKey: 'pubA', settings: {} })
      .mockResolvedValueOnce({ id: 'user2', publicKey: 'pubB', name: 'Bruno' });

    const req: any = { userId: 'user1', params: { otherUserId: 'user2' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ verified: false, keyChanged: false }));
  });

  it('detecta que la clave pública cambió desde la última verificación (alerta real)', async () => {
    const crypto = await import('crypto');
    const oldKeyHash = crypto.createHash('sha256').update('pubB-vieja').digest('hex');
    const { safetyNumberRouter } = await import('../modules/auth/safetyNumber');
    const handler = getHandler(safetyNumberRouter, 'get', '/:otherUserId');
    mockUserFindUnique
      .mockResolvedValueOnce({ publicKey: 'pubA', settings: { verifiedContacts: { user2: oldKeyHash } } })
      .mockResolvedValueOnce({ id: 'user2', publicKey: 'pubB-nueva', name: 'Bruno' });

    const req: any = { userId: 'user1', params: { otherUserId: 'user2' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ verified: false, keyChanged: true }));
  });

  it('reconoce como verificado si la clave actual coincide con la ya verificada', async () => {
    const crypto = await import('crypto');
    const currentHash = crypto.createHash('sha256').update('pubB').digest('hex');
    const { safetyNumberRouter } = await import('../modules/auth/safetyNumber');
    const handler = getHandler(safetyNumberRouter, 'get', '/:otherUserId');
    mockUserFindUnique
      .mockResolvedValueOnce({ publicKey: 'pubA', settings: { verifiedContacts: { user2: currentHash } } })
      .mockResolvedValueOnce({ id: 'user2', publicKey: 'pubB', name: 'Bruno' });

    const req: any = { userId: 'user1', params: { otherUserId: 'user2' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ verified: true, keyChanged: false }));
  });

  it('guarda la verificación sin pisar otras settings existentes', async () => {
    const { safetyNumberRouter } = await import('../modules/auth/safetyNumber');
    const handler = getHandler(safetyNumberRouter, 'post', '/:otherUserId/verify');
    mockUserFindUnique
      .mockResolvedValueOnce({ id: 'user2', publicKey: 'pubB', name: 'Bruno' })
      .mockResolvedValueOnce({ settings: { autoReply: { enabled: true, message: 'afk' } } });

    const req: any = { userId: 'user1', params: { otherUserId: 'user2' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockUserUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user1' },
      data: expect.objectContaining({
        settings: expect.objectContaining({ autoReply: { enabled: true, message: 'afk' } })
      })
    }));
    expect(res.json).toHaveBeenCalledWith({ verified: true });
  });
});
