export {}; // scope de módulo propio

const mockChatUserFindUnique = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisExpire = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: { chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) } }
}));
jest.mock('../core/database/redis', () => ({
  redis: {
    incr: (...args: any[]) => mockRedisIncr(...args),
    expire: (...args: any[]) => mockRedisExpire(...args)
  }
}));

import { registerCallHandlers } from '../modules/calls/signaling';

function createFakeSocket(userId: string) {
  const listeners: Record<string, Function> = {};
  const emitted: any[] = [];
  const socket: any = {
    userId,
    on: (event: string, cb: Function) => { listeners[event] = cb; },
    emit: (event: string, payload: any) => emitted.push({ event, payload })
  };
  const toEmits: any[] = [];
  const io: any = { to: (room: string) => ({ emit: (event: string, payload: any) => toEmits.push({ room, event, payload }) }) };
  registerCallHandlers(io, socket);
  return { listeners, emitted, toEmits };
}

describe('Señalización de llamadas — no se puede llamar a un desconocido (bug real corregido)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockRedisIncr.mockReset();
    mockRedisExpire.mockReset();
    mockRedisIncr.mockResolvedValue(1);
  });

  it('rechaza un call_offer si el que llama no pertenece al chat', async () => {
    mockChatUserFindUnique.mockResolvedValueOnce(null); // caller no es miembro
    const { listeners, toEmits } = createFakeSocket('atacante');

    await listeners['call_offer']({ toUserId: 'victima', chatId: 'chat1', sdp: {}, callType: 'audio', fromUserId: 'atacante' });

    expect(toEmits).toHaveLength(0);
  });

  it('rechaza un call_offer si el destinatario no pertenece a ese chat (llamada a un desconocido)', async () => {
    mockChatUserFindUnique
      .mockResolvedValueOnce({ userId: 'atacante', chatId: 'chat1' }) // caller sí es miembro
      .mockResolvedValueOnce(null); // destinatario NO es miembro de ese chat
    const { listeners, toEmits } = createFakeSocket('atacante');

    await listeners['call_offer']({ toUserId: 'desconocido', chatId: 'chat1', sdp: {}, callType: 'audio', fromUserId: 'atacante' });

    expect(toEmits).toHaveLength(0);
  });

  it('permite un call_offer legítimo entre dos miembros del mismo chat', async () => {
    mockChatUserFindUnique
      .mockResolvedValueOnce({ userId: 'user1', chatId: 'chat1' })
      .mockResolvedValueOnce({ userId: 'user2', chatId: 'chat1' });
    const { listeners, toEmits } = createFakeSocket('user1');

    await listeners['call_offer']({ toUserId: 'user2', chatId: 'chat1', sdp: { type: 'offer' }, callType: 'video', fromUserId: 'user1' });

    expect(toEmits).toHaveLength(1);
    expect(toEmits[0].room).toBe('user:user2');
    expect(toEmits[0].event).toBe('call_incoming');
  });

  it('frena el spam de llamadas por encima del límite por minuto', async () => {
    mockRedisIncr.mockResolvedValue(11); // ya superó el límite de 10
    const { listeners, toEmits, emitted } = createFakeSocket('spammer');

    await listeners['call_offer']({ toUserId: 'victima', chatId: 'chat1', sdp: {}, callType: 'audio', fromUserId: 'spammer' });

    expect(toEmits).toHaveLength(0);
    expect(emitted.some((e) => e.event === 'call_error')).toBe(true);
    expect(mockChatUserFindUnique).not.toHaveBeenCalled(); // ni siquiera llega a chequear membresía
  });
});
