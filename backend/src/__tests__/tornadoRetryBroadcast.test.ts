export {}; // scope de módulo propio

const mockRpop = jest.fn();
const mockLpush = jest.fn();
const mockMessageCreate = jest.fn();
const mockChatUserFindMany = jest.fn();
const mockEmit = jest.fn();
const mockSendPush = jest.fn().mockResolvedValue(undefined);

jest.mock('../core/database/redis', () => ({
  redis: {
    rpop: (...args: any[]) => mockRpop(...args),
    lpush: (...args: any[]) => mockLpush(...args)
  }
}));
jest.mock('../core/database/client', () => ({
  prisma: {
    message: { create: (...args: any[]) => mockMessageCreate(...args) },
    chatUser: { findMany: (...args: any[]) => mockChatUserFindMany(...args) }
  }
}));
jest.mock('../index', () => ({ io: { to: () => ({ emit: mockEmit }) } }));
jest.mock('../core/crypto/messageEncryption', () => ({ decryptContent: (c: string) => c.replace('enc1:', '') }));
jest.mock('../modules/notifications/push', () => ({ sendPushNotification: (...args: any[]) => mockSendPush(...args) }));

import { processRetryQueue } from '../modules/chat/tornado';

describe('Sistema Tornado (cola de reintento) — bug real corregido: antes no avisaba a nadie', () => {
  beforeEach(() => {
    mockRpop.mockReset();
    mockLpush.mockReset();
    mockMessageCreate.mockReset();
    mockChatUserFindMany.mockReset();
    mockEmit.mockClear();
    mockSendPush.mockClear();
  });

  it('no hace nada si la cola está vacía', async () => {
    mockRpop.mockResolvedValue(null);
    const result = await processRetryQueue();
    expect(result).toBeNull();
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it('al lograr guardar el mensaje reintentado, avisa por socket y por push (antes no pasaba nada)', async () => {
    mockRpop.mockResolvedValue(JSON.stringify({ chatId: 'chat1', senderId: 'user1', content: 'enc1:hola', contentType: 'TEXT' }));
    mockMessageCreate.mockResolvedValue({ id: 'msg1', chatId: 'chat1', content: 'enc1:hola' });
    mockChatUserFindMany.mockResolvedValue([{ userId: 'user2' }]);

    await processRetryQueue();

    expect(mockEmit).toHaveBeenCalledWith('new_message', expect.objectContaining({ content: 'hola' }));
    expect(mockSendPush).toHaveBeenCalledWith('user2', 'Pit', 'hola', 'user1');
  });

  it('si sigue fallando, se re-encola en vez de perderse', async () => {
    const raw = JSON.stringify({ chatId: 'chat1', senderId: 'user1', content: 'enc1:hola' });
    mockRpop.mockResolvedValue(raw);
    mockMessageCreate.mockRejectedValue(new Error('DB sigue caída'));

    const result = await processRetryQueue();

    expect(result).toBeNull();
    expect(mockLpush).toHaveBeenCalledWith('retry_queue', raw);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
