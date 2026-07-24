export {}; // fuerza scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockChatUserFindUnique = jest.fn();
const mockScheduledCreate = jest.fn();
const mockScheduledFindMany = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    scheduledMessage: {
      create: (...args: any[]) => mockScheduledCreate(...args),
      findMany: (...args: any[]) => mockScheduledFindMany(...args)
    }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Mensajes Programados — cifrado real (último hueco cerrado)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockScheduledCreate.mockReset();
    mockScheduledFindMany.mockReset();
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
  });

  it('el content que se guarda en ScheduledMessage está cifrado, no en texto plano', async () => {
    const { extrasRouter } = await import('../modules/chat/extras');
    const handler = getHandler(extrasRouter, 'post', '/schedule');

    const plainText = 'recordatorio secreto para mañana';
    mockScheduledCreate.mockResolvedValue({ id: 'sched1', content: 'lo-que-sea' });

    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: plainText, sendAt: new Date().toISOString() } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const callArgs = mockScheduledCreate.mock.calls[0][0];
    expect(callArgs.data.content).not.toBe(plainText);
    expect(callArgs.data.content).toMatch(/^enc1:/);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ content: plainText }));
  });

  it('descifra correctamente al listar mensajes programados', async () => {
    const { extrasRouter } = await import('../modules/chat/extras');
    const { encryptContent } = await import('../core/crypto/messageEncryption');
    const handler = getHandler(extrasRouter, 'get', '/scheduled/:chatId');

    const plainText = 'otro recordatorio';
    mockScheduledFindMany.mockResolvedValue([{ id: 'sched1', content: encryptContent(plainText) }]);

    const req: any = { userId: 'user1', params: { chatId: 'chat1' } };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ content: plainText })]);
  });
});
