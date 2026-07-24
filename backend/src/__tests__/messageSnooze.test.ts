export {}; // scope de módulo propio

const mockMessageFindUnique = jest.fn();
const mockChatUserFindUnique = jest.fn();

const store = new Map<string, string>();
jest.mock('../core/database/client', () => ({
  prisma: {
    message: { findUnique: (...args: any[]) => mockMessageFindUnique(...args) },
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) }
  }
}));
jest.mock('../core/database/redis', () => ({
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => { store.set(key, value); }
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de recordatorios (snooze de mensajes)', () => {
  beforeEach(() => {
    store.clear();
    mockMessageFindUnique.mockReset();
    mockChatUserFindUnique.mockReset();
    mockMessageFindUnique.mockResolvedValue({ id: 'msg-1', chatId: 'chat-1' });
    mockChatUserFindUnique.mockResolvedValue({ userId: 'user-1', chatId: 'chat-1' });
  });

  it('rechaza una fecha de reaparición inválida', async () => {
    const { snoozeRouter } = await import('../modules/chat/snooze');
    const handler = getHandler(snoozeRouter, 'post', '/:messageId');

    const req: any = { userId: 'user-1', params: { messageId: 'msg-1' }, body: { resurfaceAt: 'no-es-fecha' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza posponer un mensaje para dentro de 30 segundos (menos del mínimo de 1 minuto)', async () => {
    const { snoozeRouter } = await import('../modules/chat/snooze');
    const handler = getHandler(snoozeRouter, 'post', '/:messageId');

    const req: any = {
      userId: 'user-1',
      params: { messageId: 'msg-1' },
      body: { resurfaceAt: new Date(Date.now() + 30_000).toISOString() }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza posponer un mensaje de un chat al que no pertenecés', async () => {
    mockChatUserFindUnique.mockResolvedValue(null);
    const { snoozeRouter } = await import('../modules/chat/snooze');
    const handler = getHandler(snoozeRouter, 'post', '/:messageId');

    const req: any = {
      userId: 'user-1',
      params: { messageId: 'msg-1' },
      body: { resurfaceAt: new Date(Date.now() + 3600_000).toISOString() }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('permite posponer un mensaje válido y luego cancelarlo', async () => {
    const { snoozeRouter } = await import('../modules/chat/snooze');
    const snoozeHandler = getHandler(snoozeRouter, 'post', '/:messageId');
    const listHandler = getHandler(snoozeRouter, 'get', '/');
    const cancelHandler = getHandler(snoozeRouter, 'delete', '/:messageId');

    const resurfaceAt = new Date(Date.now() + 3600_000).toISOString();
    const req: any = { userId: 'user-1', params: { messageId: 'msg-1' }, body: { resurfaceAt } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await snoozeHandler(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ snoozed: true }));

    const listReq: any = { userId: 'user-1' };
    const listRes: any = { json: jest.fn() };
    await listHandler(listReq, listRes);
    expect(listRes.json.mock.calls[0][0]).toHaveLength(1);

    const cancelReq: any = { userId: 'user-1', params: { messageId: 'msg-1' } };
    const cancelRes: any = { json: jest.fn() };
    await cancelHandler(cancelReq, cancelRes);

    const listRes2: any = { json: jest.fn() };
    await listHandler(listReq, listRes2);
    expect(listRes2.json.mock.calls[0][0]).toHaveLength(0);
  });

  it('el worker resurfacea solo los que ya vencieron y los saca del índice', async () => {
    const { snoozeRouter, processSnoozedMessages } = await import('../modules/chat/snooze');
    const snoozeHandler = getHandler(snoozeRouter, 'post', '/:messageId');

    // Uno vencido (en el pasado, forzado a mano en el store) y otro futuro.
    await snoozeHandler(
      { userId: 'user-1', params: { messageId: 'msg-1' }, body: { resurfaceAt: new Date(Date.now() + 3600_000).toISOString() } },
      { json: jest.fn(), status: jest.fn().mockReturnThis() }
    );
    // Inserta directamente uno ya vencido en el índice compartido.
    const raw = store.get('snoozed_messages:index')!;
    const entries = JSON.parse(raw);
    entries.push({ messageId: 'msg-2', userId: 'user-1', chatId: 'chat-1', resurfaceAt: Date.now() - 1000 });
    store.set('snoozed_messages:index', JSON.stringify(entries));

    const onDue = jest.fn().mockResolvedValue(undefined);
    await processSnoozedMessages(onDue);

    expect(onDue).toHaveBeenCalledTimes(1);
    expect(onDue.mock.calls[0][0].messageId).toBe('msg-2');

    const remaining = JSON.parse(store.get('snoozed_messages:index')!);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].messageId).toBe('msg-1');
  });
});
