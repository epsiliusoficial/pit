const mockChatUserFindMany = jest.fn();
const mockMessageFindMany = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findMany: (...args: any[]) => mockChatUserFindMany(...args) },
    message: { findMany: (...args: any[]) => mockMessageFindMany(...args) }
  }
}));

import { chatListRouter } from '../modules/chat/chatList';

function getHandler() {
  const layer = (chatListRouter as any).stack.find((l: any) => l.route?.path === '/');
  return layer.route.stack[0].handle;
}

describe('Sistema de Lista de Chats — regresión de rendimiento (N+1 corregido)', () => {
  beforeEach(() => {
    mockChatUserFindMany.mockReset();
    mockMessageFindMany.mockReset();
  });

  it('hace UNA sola consulta de mensajes sin importar cuántos chats tenga el usuario', async () => {
    const memberships = Array.from({ length: 10 }, (_, i) => ({
      chatId: `chat${i}`,
      isMuted: false,
      isArchived: false,
      isPinned: false,
      chat: { name: `Chat ${i}`, isGroup: false, messages: [] }
    }));
    mockChatUserFindMany.mockResolvedValue(memberships);
    mockMessageFindMany.mockResolvedValue([]);

    const handler = getHandler();
    const req: any = { userId: 'me' };
    const res: any = { json: jest.fn() };

    await handler(req, res);

    // La prueba real de la regresión: exactamente 1 llamada a message.findMany,
    // sin importar que haya 10 chats (antes eran 10 llamadas, una por chat).
    expect(mockMessageFindMany).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalled();
  });

  it('no llama a message.findMany si el usuario no tiene chats', async () => {
    mockChatUserFindMany.mockResolvedValue([]);
    const handler = getHandler();
    await handler({ userId: 'me' } as any, { json: jest.fn() } as any);
    expect(mockMessageFindMany).not.toHaveBeenCalled();
  });
});
