export {}; // scope de módulo propio

const mockChatUserFindUnique = jest.fn();
const store: Record<string, string> = {};

jest.mock('../core/database/client', () => ({
  prisma: { chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) } }
}));

// Redis fake mínimo pero fiel: soporta get/set/del con el mismo contrato que
// ioredis para lo que usa groupCalls.ts (incluye la firma 'EX', segundos).
jest.mock('../core/database/redis', () => ({
  redis: {
    get: async (key: string) => (key in store ? store[key] : null),
    set: async (key: string, value: string, ..._rest: any[]) => { store[key] = value; },
    del: async (key: string) => { delete store[key]; }
  }
}));

import { registerGroupCallHandlers } from '../modules/calls/groupCalls';

function createFakeSocket(userId: string) {
  const listeners: Record<string, Function> = {};
  const emitted: any[] = [];
  const rooms: string[] = [];
  const socket: any = {
    userId,
    on: (event: string, cb: Function) => { listeners[event] = cb; },
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    join: (room: string) => rooms.push(room),
    leave: (room: string) => { const i = rooms.indexOf(room); if (i >= 0) rooms.splice(i, 1); },
    to: (room: string) => ({ emit: (event: string, payload: any) => broadcasts.push({ room, event, payload }) })
  };
  const broadcasts: any[] = [];
  const io: any = { to: (room: string) => ({ emit: (event: string, payload: any) => ioEmits.push({ room, event, payload }) }) };
  const ioEmits: any[] = [];
  registerGroupCallHandlers(io, socket);
  return { listeners, emitted, rooms, broadcasts, ioEmits };
}

describe('Llamadas grupales — autorización y límites (sistema nuevo)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    for (const k of Object.keys(store)) delete store[k];
  });

  it('rechaza group_call_join si el usuario no es miembro real del chat', async () => {
    mockChatUserFindUnique.mockResolvedValueOnce(null);
    const { listeners, emitted, rooms } = createFakeSocket('atacante');

    await listeners['group_call_join']({ chatId: 'chatX', callType: 'video' });

    expect(rooms).toHaveLength(0);
    expect(emitted.some((e) => e.event === 'call_error')).toBe(true);
  });

  it('permite unirse a un miembro real y le devuelve la lista de peers existentes', async () => {
    mockChatUserFindUnique.mockResolvedValue({ userId: 'user1', chatId: 'chatA' });

    const first = createFakeSocket('user1');
    await first.listeners['group_call_join']({ chatId: 'chatA', callType: 'video' });
    expect(first.emitted[0]).toMatchObject({ event: 'group_call_joined', payload: { peers: [] } });

    const second = createFakeSocket('user2');
    await second.listeners['group_call_join']({ chatId: 'chatA', callType: 'video' });
    expect(second.emitted[0]).toMatchObject({ event: 'group_call_joined', payload: { peers: ['user1'] } });
  });

  it('no deja pasar del máximo de participantes', async () => {
    mockChatUserFindUnique.mockResolvedValue({ userId: 'x', chatId: 'chatFull' });

    for (let i = 0; i < 8; i++) {
      const s = createFakeSocket(`user${i}`);
      await s.listeners['group_call_join']({ chatId: 'chatFull', callType: 'audio' });
    }
    const ninth = createFakeSocket('user9');
    await ninth.listeners['group_call_join']({ chatId: 'chatFull', callType: 'audio' });

    expect(ninth.emitted.some((e) => e.event === 'call_error')).toBe(true);
  });

  it('borra la llamada cuando el último participante se va (no queda huérfana en Redis)', async () => {
    mockChatUserFindUnique.mockResolvedValue({ userId: 'user1', chatId: 'chatB' });
    const s = createFakeSocket('user1');
    await s.listeners['group_call_join']({ chatId: 'chatB', callType: 'video' });
    expect(store['group_call:chatB']).toBeDefined();

    await s.listeners['group_call_leave']({ chatId: 'chatB' });
    expect(store['group_call:chatB']).toBeUndefined();
  });
});
