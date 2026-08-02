export {}; // scope de módulo propio

const mockContactFindMany = jest.fn();
const mockBlockFindMany = jest.fn();
const mockStatusFindMany = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    contact: { findMany: (...args: any[]) => mockContactFindMany(...args) },
    block: { findMany: (...args: any[]) => mockBlockFindMany(...args) },
    status: { findMany: (...args: any[]) => mockStatusFindMany(...args) }
  }
}));

jest.mock('../core/crypto/messageEncryption', () => ({
  encryptContent: (c: string) => c,
  decryptContent: (c: string) => c
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Estados — feed excluye bloqueos mutuos (bug de privacidad corregido)', () => {
  beforeEach(() => {
    mockContactFindMany.mockReset();
    mockBlockFindMany.mockReset();
    mockStatusFindMany.mockReset();
  });

  it('no incluye en el feed a un contacto que bloqueó al usuario (ni a la inversa)', async () => {
    const { statusRouter } = await import('../modules/social/status');
    const handler = getHandler(statusRouter, '/feed');

    mockContactFindMany.mockResolvedValue([{ contactId: 'contacto-bloqueador' }, { contactId: 'contacto-normal' }]);
    // El contacto me bloqueó a mí.
    mockBlockFindMany
      .mockResolvedValueOnce([]) // blockedByMe
      .mockResolvedValueOnce([{ blockerId: 'contacto-bloqueador' }]); // blockedMe
    mockStatusFindMany.mockResolvedValue([]);

    const req: any = { userId: 'yo' };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    const whereArg = mockStatusFindMany.mock.calls[0][0].where;
    expect(whereArg.userId.in).not.toContain('contacto-bloqueador');
    expect(whereArg.userId.in).toContain('contacto-normal');
    expect(whereArg.userId.in).toContain('yo');
  });
});
