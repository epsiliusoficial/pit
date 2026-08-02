export {}; // scope de módulo propio

const mockChatFindUnique = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockChatUserCreate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chat: { findUnique: (...args: any[]) => mockChatFindUnique(...args) },
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      create: (...args: any[]) => mockChatUserCreate(...args)
    }
  }
}));

// Cache en memoria simple para los tests (misma interfaz get/set/del que el real).
const store = new Map<string, string>();
jest.mock('../core/database/redis', () => ({
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => { store.set(key, value); },
    del: async (key: string) => { store.delete(key); }
  }
}));

import { inviteRouter } from '../modules/chat/invites';

function getHandler(path: string, method: 'post' | 'delete') {
  const layer: any = inviteRouter.stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Sistema de invitaciones — validación de TTL, límite de usos, revocación', () => {
  beforeEach(() => {
    store.clear();
    mockChatFindUnique.mockReset();
    mockChatUserFindUnique.mockReset();
    mockChatUserCreate.mockReset();
    mockChatFindUnique.mockResolvedValue({ id: 'chat-1', isGroup: true });
    mockChatUserFindUnique.mockResolvedValue({ userId: 'admin-1', chatId: 'chat-1', role: 'ADMIN' });
  });

  it('rechaza expiresInSeconds negativo (bug real corregido, antes rompía Redis)', async () => {
    const create = getHandler('/create/:chatId', 'post');
    const req: any = { params: { chatId: 'chat-1' }, body: { expiresInSeconds: -5 }, userId: 'admin-1' };
    const res = mockRes();
    await create(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza expiresInSeconds no numérico', async () => {
    const create = getHandler('/create/:chatId', 'post');
    const req: any = { params: { chatId: 'chat-1' }, body: { expiresInSeconds: 'no-es-un-numero' }, userId: 'admin-1' };
    const res = mockRes();
    await create(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza expiresInSeconds por encima del máximo (30 días)', async () => {
    const create = getHandler('/create/:chatId', 'post');
    const req: any = { params: { chatId: 'chat-1' }, body: { expiresInSeconds: 999_999_999 }, userId: 'admin-1' };
    const res = mockRes();
    await create(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('crea una invitación con límite de usos y la agota tras alcanzarlo', async () => {
    const create = getHandler('/create/:chatId', 'post');
    const createReq: any = { params: { chatId: 'chat-1' }, body: { maxUses: 1 }, userId: 'admin-1' };
    const createRes = mockRes();
    await create(createReq, createRes, jest.fn());
    const { token } = createRes.json.mock.calls[0][0];

    const accept = getHandler('/accept/:token', 'post');

    mockChatUserFindUnique.mockResolvedValueOnce(null); // no es miembro todavía
    const acceptReq1: any = { params: { token }, userId: 'user-1' };
    const acceptRes1 = mockRes();
    await accept(acceptReq1, acceptRes1, jest.fn());
    expect(acceptRes1.json).toHaveBeenCalledWith(expect.objectContaining({ joined: true }));

    // Segundo uso: la invitación ya se agotó y debe rechazarse.
    mockChatUserFindUnique.mockResolvedValueOnce(null);
    const acceptReq2: any = { params: { token }, userId: 'user-2' };
    const acceptRes2 = mockRes();
    await accept(acceptReq2, acceptRes2, jest.fn());
    expect(acceptRes2.status).toHaveBeenCalledWith(400);
  });

  it('permite a un admin revocar una invitación antes de que expire o se use', async () => {
    const create = getHandler('/create/:chatId', 'post');
    const createReq: any = { params: { chatId: 'chat-1' }, body: {}, userId: 'admin-1' };
    const createRes = mockRes();
    await create(createReq, createRes, jest.fn());
    const { token } = createRes.json.mock.calls[0][0];

    const revoke = getHandler('/:token', 'delete');
    const revokeReq: any = { params: { token }, userId: 'admin-1' };
    const revokeRes = mockRes();
    await revoke(revokeReq, revokeRes, jest.fn());
    expect(revokeRes.json).toHaveBeenCalledWith({ revoked: true });

    // Una vez revocada, aceptar debe fallar.
    const accept = getHandler('/accept/:token', 'post');
    const acceptReq: any = { params: { token }, userId: 'user-1' };
    const acceptRes = mockRes();
    await accept(acceptReq, acceptRes, jest.fn());
    expect(acceptRes.status).toHaveBeenCalledWith(400);
  });

  it('un no-admin no puede revocar la invitación de otro grupo', async () => {
    const create = getHandler('/create/:chatId', 'post');
    const createReq: any = { params: { chatId: 'chat-1' }, body: {}, userId: 'admin-1' };
    const createRes = mockRes();
    await create(createReq, createRes, jest.fn());
    const { token } = createRes.json.mock.calls[0][0];

    mockChatUserFindUnique.mockResolvedValueOnce({ userId: 'user-2', chatId: 'chat-1', role: 'MEMBER' });
    const revoke = getHandler('/:token', 'delete');
    const revokeReq: any = { params: { token }, userId: 'user-2' };
    const revokeRes = mockRes();
    await revoke(revokeReq, revokeRes, jest.fn());
    expect(revokeRes.status).toHaveBeenCalledWith(403);
  });
});
