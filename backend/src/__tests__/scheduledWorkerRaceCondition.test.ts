export {}; // scope de módulo propio

const mockFindMany = jest.fn();
const mockUpdateMany = jest.fn();
const mockMessageCreate = jest.fn();
const mockEmit = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    scheduledMessage: {
      findMany: (...args: any[]) => mockFindMany(...args),
      updateMany: (...args: any[]) => mockUpdateMany(...args)
    },
    message: { create: (...args: any[]) => mockMessageCreate(...args) }
  }
}));
jest.mock('../index', () => ({ io: { to: () => ({ emit: mockEmit }) } }));
jest.mock('../core/crypto/messageEncryption', () => ({ decryptContent: (c: string) => c }));

import { processScheduledMessages } from '../core/queue/scheduledWorker';

describe('Worker de mensajes programados — condición de carrera corregida', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockUpdateMany.mockReset();
    mockMessageCreate.mockReset();
    mockEmit.mockReset();
  });

  it('no envía un mensaje si otra instancia ya lo reclamó (updateMany count 0)', async () => {
    mockFindMany.mockResolvedValue([{ id: 'sched-1', chatId: 'chat-1', senderId: 'user-1', content: 'hola' }]);
    mockUpdateMany.mockResolvedValue({ count: 0 }); // ya lo reclamó otra instancia

    await processScheduledMessages();

    expect(mockMessageCreate).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('envía el mensaje una sola vez cuando logra reclamarlo (count 1)', async () => {
    mockFindMany.mockResolvedValue([{ id: 'sched-1', chatId: 'chat-1', senderId: 'user-1', content: 'hola' }]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockMessageCreate.mockResolvedValue({ id: 'msg-1', chatId: 'chat-1', content: 'hola' });

    await processScheduledMessages();

    expect(mockMessageCreate).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it('reclama antes de crear: el updateMany usa sent:false como guarda atómica', async () => {
    mockFindMany.mockResolvedValue([{ id: 'sched-1', chatId: 'chat-1', senderId: 'user-1', content: 'hola' }]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockMessageCreate.mockResolvedValue({ id: 'msg-1', chatId: 'chat-1', content: 'hola' });

    await processScheduledMessages();

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'sched-1', sent: false },
      data: { sent: true }
    });
  });
});
