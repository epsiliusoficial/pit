export {}; // scope de módulo

const mockChatUserFindUnique = jest.fn();
const mockChatFindUnique = jest.fn();
const mockChatUpdate = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    chatUser: { findUnique: (...args: any[]) => mockChatUserFindUnique(...args) },
    chat: {
      findUnique: (...args: any[]) => mockChatFindUnique(...args),
      update: (...args: any[]) => mockChatUpdate(...args)
    },
    $transaction: (...args: any[]) => mockTransaction(...args)
  }
}));

function getHandler(router: any, method: string, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de División de Gastos (nuevo, tipo Splitwise)', () => {
  beforeEach(() => {
    mockChatUserFindUnique.mockReset();
    mockChatFindUnique.mockReset();
    mockChatUpdate.mockReset();
    mockTransaction.mockReset();
  });

  it('rechaza crear un gasto con totalAmount negativo o cero', async () => {
    const { splitBillRouter } = await import('../modules/wallet/splitBill');
    const handler = getHandler(splitBillRouter, 'post', '/:chatId');

    const req: any = { userId: 'user1', params: { chatId: 'chatA' }, body: { description: 'Asado', totalAmount: 0, participantUserIds: ['user2'] } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza si algún participante no es miembro del chat', async () => {
    const { splitBillRouter } = await import('../modules/wallet/splitBill');
    const handler = getHandler(splitBillRouter, 'post', '/:chatId');
    mockChatUserFindUnique
      .mockResolvedValueOnce({ role: 'MEMBER' }) // quien crea
      .mockResolvedValueOnce(null); // participante no es miembro

    const req: any = {
      userId: 'user1', params: { chatId: 'chatA' },
      body: { description: 'Asado', totalAmount: 3000, participantUserIds: ['userX'] }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });

  it('crea el gasto dividido en partes iguales, marcando a quien pagó como ya saldado', async () => {
    const { splitBillRouter } = await import('../modules/wallet/splitBill');
    const handler = getHandler(splitBillRouter, 'post', '/:chatId');
    mockChatUserFindUnique.mockResolvedValue({ role: 'MEMBER' });
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', groupConfig: {} });

    const req: any = {
      userId: 'user1', params: { chatId: 'chatA' },
      body: { description: 'Asado', totalAmount: 3000, participantUserIds: ['user1', 'user2', 'user3'] }
    };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const bill = res.json.mock.calls[0][0];
    expect(bill.participants).toEqual([
      { userId: 'user1', share: 1000, settled: true },
      { userId: 'user2', share: 1000, settled: false },
      { userId: 'user3', share: 1000, settled: false }
    ]);
  });

  it('rechaza saldar un gasto que no existe', async () => {
    const { splitBillRouter } = await import('../modules/wallet/splitBill');
    const handler = getHandler(splitBillRouter, 'post', '/:chatId/:billId/settle');
    mockChatFindUnique.mockResolvedValue({ groupConfig: { splitBills: [] } });

    const req: any = { userId: 'user2', params: { chatId: 'chatA', billId: 'nope' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rechaza saldar si no sos participante del gasto', async () => {
    const { splitBillRouter } = await import('../modules/wallet/splitBill');
    const handler = getHandler(splitBillRouter, 'post', '/:chatId/:billId/settle');
    mockChatFindUnique.mockResolvedValue({
      groupConfig: { splitBills: [{ id: 'bill1', paidBy: 'user1', participants: [{ userId: 'user1', share: 1000, settled: true }] }] }
    });

    const req: any = { userId: 'userIntruso', params: { chatId: 'chatA', billId: 'bill1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rechaza saldar dos veces la misma parte', async () => {
    const { splitBillRouter } = await import('../modules/wallet/splitBill');
    const handler = getHandler(splitBillRouter, 'post', '/:chatId/:billId/settle');
    mockChatFindUnique.mockResolvedValue({
      groupConfig: { splitBills: [{ id: 'bill1', paidBy: 'user1', participants: [{ userId: 'user2', share: 1000, settled: true }] }] }
    });

    const req: any = { userId: 'user2', params: { chatId: 'chatA', billId: 'bill1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('salda la parte moviendo plata real vía Billetera y marca settled', async () => {
    const { splitBillRouter } = await import('../modules/wallet/splitBill');
    const handler = getHandler(splitBillRouter, 'post', '/:chatId/:billId/settle');
    const bill = { id: 'bill1', description: 'Asado', paidBy: 'user1', participants: [{ userId: 'user2', share: 1000, settled: false }] };
    mockChatFindUnique.mockResolvedValue({ groupConfig: { splitBills: [bill] } });
    mockTransaction.mockImplementation(async (cb: any) => cb({
      wallet: {
        findUnique: jest.fn().mockResolvedValue({ balance: 5000 }),
        update: jest.fn(),
        upsert: jest.fn()
      },
      transaction: { create: jest.fn() }
    }));

    const req: any = { userId: 'user2', params: { chatId: 'chatA', billId: 'bill1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockTransaction).toHaveBeenCalled();
    expect(mockChatUpdate).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ settled: true, allSettled: true });
  });

  it('rechaza saldar si no alcanza el saldo de la billetera', async () => {
    const { splitBillRouter } = await import('../modules/wallet/splitBill');
    const handler = getHandler(splitBillRouter, 'post', '/:chatId/:billId/settle');
    const bill = { id: 'bill1', description: 'Asado', paidBy: 'user1', participants: [{ userId: 'user2', share: 1000, settled: false }] };
    mockChatFindUnique.mockResolvedValue({ groupConfig: { splitBills: [bill] } });
    mockTransaction.mockImplementation(async (cb: any) => cb({
      wallet: { findUnique: jest.fn().mockResolvedValue({ balance: 100 }), update: jest.fn(), upsert: jest.fn() },
      transaction: { create: jest.fn() }
    }));

    const req: any = { userId: 'user2', params: { chatId: 'chatA', billId: 'bill1' } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockChatUpdate).not.toHaveBeenCalled();
  });
});
