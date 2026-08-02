export {}; // fuerza scope de módulo

const mockChatUserFindMany = jest.fn();
const mockMessageFindMany = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findMany: (...args: any[]) => mockChatUserFindMany(...args) },
    message: { findMany: (...args: any[]) => mockMessageFindMany(...args) }
  }
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Lista de Chats — descifrado de vista previa (bug real corregido)', () => {
  beforeEach(() => {
    mockChatUserFindMany.mockReset();
    mockMessageFindMany.mockReset();
  });

  it('descifra el contenido del último mensaje antes de responder (antes se filtraba el ciphertext)', async () => {
    const { chatListRouter } = await import('../modules/chat/chatList');
    const { encryptContent } = await import('../core/crypto/messageEncryption');
    const handler = getHandler(chatListRouter, '/');

    const plainText = 'hola, este es el último mensaje';
    mockChatUserFindMany.mockResolvedValue([
      {
        chatId: 'chat1', isMuted: false, isArchived: false, isPinned: false,
        chat: { name: 'Chat 1', isGroup: false, messages: [{ content: encryptContent(plainText), createdAt: new Date() }] }
      }
    ]);
    mockMessageFindMany.mockResolvedValue([]);

    const req: any = { userId: 'me' };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result[0].lastMessage.content).toBe(plainText);
    expect(result[0].lastMessage.content).not.toMatch(/^enc1:/);
  });
});
