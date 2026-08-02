export {}; // scope de módulo propio

jest.mock('../index', () => ({ io: { to: () => ({ emit: jest.fn() }) } }));

const mockStickerFindUnique = jest.fn();
const mockStickerUpdate = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockChatUserFindMany = jest.fn();
const mockMessageCreate = jest.fn();
const mockUserFindUnique = jest.fn();
const mockSendPush = jest.fn().mockResolvedValue(undefined);
const mockRegisterActivity = jest.fn();
const mockEncryptContent = jest.fn((c: string) => `enc1:${c}`);

jest.mock('../core/database/client', () => ({
  prisma: {
    sticker: {
      findUnique: (...args: any[]) => mockStickerFindUnique(...args),
      update: (...args: any[]) => mockStickerUpdate(...args)
    },
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      findMany: (...args: any[]) => mockChatUserFindMany(...args)
    },
    message: { create: (...args: any[]) => mockMessageCreate(...args) },
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) }
  }
}));
jest.mock('../core/crypto/messageEncryption', () => ({ encryptContent: (c: string) => mockEncryptContent(c) }));
jest.mock('../modules/notifications/push', () => ({ sendPushNotification: (...args: any[]) => mockSendPush(...args) }));
jest.mock('../modules/social/achievements', () => ({
  registerActivity: (...args: any[]) => mockRegisterActivity(...args),
  BADGES: {}
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('Stickers — cifrado real y notificaciones (2 bugs reales corregidos)', () => {
  beforeEach(() => {
    mockStickerFindUnique.mockReset();
    mockStickerUpdate.mockReset();
    mockChatUserFindUnique.mockReset();
    mockChatUserFindMany.mockReset();
    mockMessageCreate.mockReset();
    mockUserFindUnique.mockReset();
    mockSendPush.mockClear();
    mockRegisterActivity.mockReset();
    mockEncryptContent.mockClear();

    mockStickerFindUnique.mockResolvedValue({ id: 'sticker1', emoji: '🎉', imageUrl: 'https://x/sticker.png' });
    mockChatUserFindUnique.mockResolvedValue({ userId: 'user1', chatId: 'chat1' });
    mockChatUserFindMany.mockResolvedValue([{ userId: 'user2' }]);
    mockUserFindUnique.mockResolvedValue({ name: 'Mateo' });
    mockMessageCreate.mockResolvedValue({ id: 'msg1', chatId: 'chat1', content: 'enc1:🎉' });
    mockStickerUpdate.mockResolvedValue({});
    mockRegisterActivity.mockResolvedValue({ streak: 1, unlocked: [] });
  });

  it('cifra el contenido del sticker igual que cualquier mensaje (antes se guardaba en texto plano)', async () => {
    const { stickerRouter } = await import('../modules/chat/stickers');
    const handler = getHandler(stickerRouter, '/send');

    const req: any = { userId: 'user1', body: { chatId: 'chat1', stickerId: 'sticker1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockEncryptContent).toHaveBeenCalledWith('🎉');
    expect(mockMessageCreate.mock.calls[0][0].data.content).toBe('enc1:🎉');
  });

  it('manda push a los demás miembros del chat (antes ningún sticker notificaba)', async () => {
    const { stickerRouter } = await import('../modules/chat/stickers');
    const handler = getHandler(stickerRouter, '/send');

    const req: any = { userId: 'user1', body: { chatId: 'chat1', stickerId: 'sticker1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockSendPush).toHaveBeenCalledWith('user2', 'Mateo', '🎉 Sticker', 'user1');
  });

  it('registra actividad para racha/logros (antes mandar solo stickers no contaba)', async () => {
    const { stickerRouter } = await import('../modules/chat/stickers');
    const handler = getHandler(stickerRouter, '/send');

    const req: any = { userId: 'user1', body: { chatId: 'chat1', stickerId: 'sticker1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);
    await flushPromises();

    expect(mockRegisterActivity).toHaveBeenCalledWith('user1');
  });
});
