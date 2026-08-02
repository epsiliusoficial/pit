export {}; // scope de módulo propio

const mockChatUserFindUnique = jest.fn();
const store: Record<string, string> = {};

jest.mock('../core/database/client', () => ({
  prisma: { chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) } }
}));

jest.mock('../core/database/redis', () => ({
  redis: {
    get: async (key: string) => (key in store ? store[key] : null),
    set: async (key: string, value: string, ..._rest: any[]) => { store[key] = value; },
    del: async (key: string) => { delete store[key]; }
  }
}));

import { registerLiveLocationHandlers } from '../modules/chat/liveLocation';

function createFakeSocket(userId: string) {
  const listeners: Record<string, Function> = {};
  const emitted: any[] = [];
  const socket: any = {
    userId,
    on: (event: string, cb: Function) => { listeners[event] = cb; },
    emit: (event: string, payload: any) => emitted.push({ event, payload })
  };
  const ioEmits: any[] = [];
  const io: any = { to: () => ({ emit: (event: string, payload: any) => ioEmits.push({ event, payload }) }) };
  registerLiveLocationHandlers(io, socket);
  return { listeners, emitted, ioEmits };
}

describe('Ubicación en Vivo — autorización, validación y limpieza (sistema nuevo)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    for (const k of Object.keys(store)) delete store[k];
  });

  it('rechaza compartir ubicación si el usuario no es miembro real del chat', async () => {
    mockChatUserFindUnique.mockResolvedValueOnce(null);
    const { listeners, emitted, ioEmits } = createFakeSocket('atacante');

    await listeners['location_share_start']({ chatId: 'chatX', lat: -31.4, lng: -64.2, durationSeconds: 900 });

    expect(ioEmits).toHaveLength(0);
    expect(emitted.some((e) => e.event === 'location_error')).toBe(true);
  });

  it('rechaza coordenadas fuera de rango válido', async () => {
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    const { listeners, emitted } = createFakeSocket('user1');

    await listeners['location_share_start']({ chatId: 'chatA', lat: 999, lng: -64.2, durationSeconds: 900 });

    expect(emitted.some((e) => e.event === 'location_error' && /inválidas/.test(e.payload.error))).toBe(true);
  });

  it('usa 15 minutos por defecto si la duración pedida no es una de las permitidas', async () => {
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    const { listeners, ioEmits } = createFakeSocket('user1');

    await listeners['location_share_start']({ chatId: 'chatA', lat: 10, lng: 10, durationSeconds: 999999999 });

    const started = ioEmits.find((e) => e.event === 'location_share_started');
    expect(started).toBeDefined();
    expect(started.payload.expiresAt - started.payload.startedAt).toBeLessThanOrEqual(15 * 60 * 1000 + 50);
  });

  it('ignora location_update si esa persona no está compartiendo (evita fugas de ubicación no autorizadas)', async () => {
    const { listeners, ioEmits } = createFakeSocket('user1');
    await listeners['location_update']({ chatId: 'chatA', lat: 5, lng: 5 });
    expect(ioEmits).toHaveLength(0);
  });

  it('propaga location_update solo después de haber empezado a compartir', async () => {
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    const { listeners, ioEmits } = createFakeSocket('user1');

    await listeners['location_share_start']({ chatId: 'chatA', lat: 1, lng: 1, durationSeconds: 900 });
    await listeners['location_update']({ chatId: 'chatA', lat: 2, lng: 2 });

    expect(ioEmits.some((e) => e.event === 'location_update' && e.payload.lat === 2)).toBe(true);
  });

  it('borra el estado al detener el compartir', async () => {
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    const { listeners } = createFakeSocket('user1');

    await listeners['location_share_start']({ chatId: 'chatA', lat: 1, lng: 1, durationSeconds: 900 });
    expect(store['live_location:chatA:user1']).toBeDefined();

    await listeners['location_share_stop']({ chatId: 'chatA' });
    expect(store['live_location:chatA:user1']).toBeUndefined();
  });

  it('location_share_status no devuelve nada a quien no es miembro del chat', async () => {
    mockChatUserFindUnique.mockResolvedValueOnce(null);
    const { listeners, emitted } = createFakeSocket('atacante');

    await listeners['location_share_status']({ chatId: 'chatAjeno' });

    expect(emitted).toHaveLength(0);
  });
});
