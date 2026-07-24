const mockFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: { chatUser: { findUnique: (...args: any[]) => mockFindUnique(...args) } }
}));
jest.mock('jsonwebtoken', () => ({ verify: jest.fn(), sign: jest.fn() }));
jest.mock('../modules/chat/presence', () => ({ registerPresenceHandlers: jest.fn() }));
jest.mock('../modules/calls/signaling', () => ({ registerCallHandlers: jest.fn() }));

import { registerSocketHandlers } from '../api/ws/handlers';

function createFakeIoAndSocket(authenticatedUserId: string) {
  const listeners: Record<string, Function> = {};
  const joined: string[] = [];
  const socket: any = {
    userId: authenticatedUserId,
    join: (room: string) => joined.push(room),
    leave: jest.fn(),
    on: (event: string, cb: Function) => { listeners[event] = cb; }
  };
  let connectionHandler: Function = () => {};
  const io: any = {
    use: jest.fn(),
    on: (event: string, cb: Function) => { if (event === 'connection') connectionHandler = cb; }
  };
  registerSocketHandlers(io);
  connectionHandler(socket);
  return { listeners, joined };
}

describe('Autorización de salas de socket (vulnerabilidad corregida)', () => {
  beforeEach(() => mockFindUnique.mockReset());

  it('NO permite unirse a un chat del que el usuario no es miembro', async () => {
    mockFindUnique.mockResolvedValue(null); // no es miembro
    const { listeners, joined } = createFakeIoAndSocket('usuario-atacante');

    await listeners['join_room']('chat-ajeno');

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { userId_chatId: { userId: 'usuario-atacante', chatId: 'chat-ajeno' } }
    });
    expect(joined).not.toContain('chat-ajeno');
  });

  it('permite unirse cuando sí es miembro real del chat', async () => {
    mockFindUnique.mockResolvedValue({ userId: 'usuario-real', chatId: 'chat-propio' });
    const { listeners, joined } = createFakeIoAndSocket('usuario-real');

    await listeners['join_room']('chat-propio');

    expect(joined).toContain('chat-propio');
  });
});
