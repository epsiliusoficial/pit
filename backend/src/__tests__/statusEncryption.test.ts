export {}; // fuerza scope de módulo

const mockStatusCreate = jest.fn();
const mockStatusFindMany = jest.fn();
const mockContactFindMany = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    status: {
      create: (...args: any[]) => mockStatusCreate(...args),
      findMany: (...args: any[]) => mockStatusFindMany(...args)
    },
    contact: { findMany: (...args: any[]) => mockContactFindMany(...args) },
    block: { findMany: jest.fn().mockResolvedValue([]) }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Estados/Historias — cifrado real (consistencia con mensajes)', () => {
  beforeEach(() => {
    mockStatusCreate.mockReset();
    mockStatusFindMany.mockReset();
    mockContactFindMany.mockReset();
    mockContactFindMany.mockResolvedValue([]);
  });

  it('el content que se guarda en Status está cifrado, no en texto plano', async () => {
    const { statusRouter } = await import('../modules/social/status');
    const handler = getHandler(statusRouter, 'post', '/create');

    const plainText = 'mi estado personal de hoy';
    mockStatusCreate.mockResolvedValue({ id: 'status1', content: 'lo-que-sea' });

    const req: any = { userId: 'user1', body: { content: plainText } };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    const callArgs = mockStatusCreate.mock.calls[0][0];
    expect(callArgs.data.content).not.toBe(plainText);
    expect(callArgs.data.content).toMatch(/^enc1:/);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ content: plainText }));
  });

  it('descifra correctamente en el feed', async () => {
    const { statusRouter } = await import('../modules/social/status');
    const { encryptContent } = await import('../core/crypto/messageEncryption');
    const handler = getHandler(statusRouter, 'get', '/feed');

    const plainText = 'estado de un contacto';
    mockStatusFindMany.mockResolvedValue([{ id: 's1', content: encryptContent(plainText) }]);

    const req: any = { userId: 'user1' };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ content: plainText })]);
  });
});
