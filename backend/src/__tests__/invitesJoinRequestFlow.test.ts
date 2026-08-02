export {}; // scope de módulo propio

const mockChatFindUnique = jest.fn();
const mockChatUserFindUnique = jest.fn();
const mockChatUserCreate = jest.fn();
const mockChatUpdate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chat: {
      findUnique: (...args: any[]) => mockChatFindUnique(...args),
      update: (...args: any[]) => mockChatUpdate(...args)
    },
    chatUser: {
      findUnique: (...args: any[]) => mockChatUserFindUnique(...args),
      create: (...args: any[]) => mockChatUserCreate(...args)
    }
  }
}));

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

describe('Invitación con Solicitud de Unión pendiente (grupo con requireApproval activado)', () => {
  beforeEach(() => {
    mockChatFindUnique.mockReset();
    mockChatUserFindUnique.mockReset();
    mockChatUserCreate.mockReset();
    mockChatUpdate.mockReset();
    store.clear();
  });

  it('queda pendiente de aprobación en vez de unirse directo, si el grupo lo exige', async () => {
    store.set('invite:tok1', JSON.stringify({ chatId: 'chatA', maxUses: null, usesLeft: null, createdBy: 'admin1' }));
    mockChatUserFindUnique.mockResolvedValue(null); // no es miembro todavía
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', groupConfig: { requireApproval: true, joinRequests: [] } });

    const handler = getHandler('/accept/:token', 'post');
    const req: any = { userId: 'user2', params: { token: 'tok1' } };
    const res = mockRes();
    await handler(req, res);

    expect(mockChatUserCreate).not.toHaveBeenCalled();
    expect(mockChatUpdate).toHaveBeenCalledWith({
      where: { id: 'chatA' },
      data: { groupConfig: { requireApproval: true, joinRequests: [{ userId: 'user2', requestedAt: expect.any(String) }] } }
    });
    expect(res.json).toHaveBeenCalledWith({ pendingApproval: true, chatId: 'chatA' });
  });

  it('sin requireApproval, se une directo como siempre (comportamiento sin cambios)', async () => {
    store.set('invite:tok2', JSON.stringify({ chatId: 'chatA', maxUses: null, usesLeft: null, createdBy: 'admin1' }));
    mockChatUserFindUnique.mockResolvedValue(null);
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', groupConfig: {} });

    const handler = getHandler('/accept/:token', 'post');
    const req: any = { userId: 'user2', params: { token: 'tok2' } };
    const res = mockRes();
    await handler(req, res);

    expect(mockChatUserCreate).toHaveBeenCalledWith({ data: { userId: 'user2', chatId: 'chatA', role: 'MEMBER' } });
    expect(res.json).toHaveBeenCalledWith({ joined: true, chatId: 'chatA' });
  });
});
