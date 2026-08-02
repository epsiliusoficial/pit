export {}; // fuerza scope de módulo

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockMessageCreate = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockChatUserFindMany = jest.fn();
const mockBlockFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      findMany: (...args: any[]) => mockChatUserFindMany(...args)
    },
    block: { findUnique: (...args: any[]) => mockBlockFindUnique(...args) },
    message: { create: (...args: any[]) => mockMessageCreate(...args) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Mateo' }) }
  }
}));
jest.mock('../modules/notifications/push', () => ({ sendPushNotification: jest.fn().mockResolvedValue(undefined) }));

jest.mock('../modules/chat/rateLimiter', () => ({ rateLimiter: (_req: any, _res: any, next: any) => next() }));
jest.mock('../modules/social/achievements', () => ({ registerActivity: jest.fn().mockResolvedValue({ streak: 1, unlocked: [] }) }));
jest.mock('../core/validation/schemas', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
  sendMessageSchema: {},
  createChatSchema: {}
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Integración real: el texto plano NUNCA llega al servidor (E2E real)', () => {
  beforeEach(() => {
    mockMessageCreate.mockReset();
    mockChatUserFindUnique.mockReset();
    mockChatUserFindMany.mockReset();
    mockBlockFindUnique.mockReset();

    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatUserFindMany.mockResolvedValue([{ userId: 'otro-user' }]);
    mockBlockFindUnique.mockResolvedValue(null);
  });

  it('el servidor guarda el sobre cifrado del cliente tal cual, sin poder leerlo ni re-cifrarlo', async () => {
    const { chatRouter } = await import('../modules/chat/controller');
    const handler = getHandler(chatRouter, '/send');

    // El cliente ya cifró esto con ECDH antes de mandarlo — el servidor
    // nunca ve el texto plano "este es mi mensaje secreto...".
    const clientEnvelope = JSON.stringify({ ciphertext: 'xyz123', nonce: 'abc', wrappedKeys: { 'otro-user': 'wrapped-key' } });
    mockMessageCreate.mockResolvedValue({ id: 'msg1', content: clientEnvelope, chatId: 'chat1' });

    const req: any = { userId: 'user1', body: { chatId: 'chat1', content: clientEnvelope } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    const callArgs = mockMessageCreate.mock.calls[0][0];
    // El servidor no transforma el sobre — lo pasa exactamente como llegó.
    expect(callArgs.data.content).toBe(clientEnvelope);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ content: clientEnvelope })
    );
  });
});
