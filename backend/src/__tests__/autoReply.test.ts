export {}; // scope de módulo

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const store: Record<string, string> = {};

jest.mock('../core/database/client', () => ({
  prisma: { user: { findUnique: (...args: any[]) => mockUserFindUnique(...args), update: (...args: any[]) => mockUserUpdate(...args) } }
}));

jest.mock('../core/database/redis', () => ({
  redis: {
    get: async (key: string) => (key in store ? store[key] : null),
    set: async (key: string, value: string, ..._rest: any[]) => { store[key] = value; }
  }
}));

import { maybeGetAutoReply } from '../modules/chat/autoReply';

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de Auto-Respuesta / Modo Ausente — sistema nuevo', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset();
    for (const k of Object.keys(store)) delete store[k];
  });

  it('rechaza activar sin mensaje configurado', async () => {
    const { autoReplyRouter } = await import('../modules/chat/autoReply');
    const handler = getHandler(autoReplyRouter, 'post', '/');

    const req: any = { userId: 'user1', body: { enabled: true, message: '' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('devuelve null si el destinatario no tiene la auto-respuesta activada', async () => {
    mockUserFindUnique.mockResolvedValue({ settings: {} });
    const result = await maybeGetAutoReply('destinatario', 'chatA', 'remitente', false);
    expect(result).toBeNull();
  });

  it('devuelve el mensaje configurado la primera vez que le escriben', async () => {
    mockUserFindUnique.mockResolvedValue({ settings: { autoReply: { enabled: true, message: 'Estoy de vacaciones' } } });
    const result = await maybeGetAutoReply('destinatario', 'chatA', 'remitente', false);
    expect(result).toBe('Estoy de vacaciones');
  });

  it('no repite la auto-respuesta al mismo remitente en el mismo chat (cooldown real)', async () => {
    mockUserFindUnique.mockResolvedValue({ settings: { autoReply: { enabled: true, message: 'Estoy de vacaciones' } } });
    const first = await maybeGetAutoReply('destinatario', 'chatA', 'remitente', false);
    const second = await maybeGetAutoReply('destinatario', 'chatA', 'remitente', false);
    expect(first).toBe('Estoy de vacaciones');
    expect(second).toBeNull();
  });

  it('nunca se auto-responde a un mensaje que ya era una auto-respuesta (evita el loop infinito)', async () => {
    mockUserFindUnique.mockResolvedValue({ settings: { autoReply: { enabled: true, message: 'Estoy de vacaciones' } } });
    const result = await maybeGetAutoReply('userA', 'chatA', 'userB', true);
    expect(result).toBeNull();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });
});
