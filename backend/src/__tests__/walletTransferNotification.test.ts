export {}; // scope de módulo propio

const mockTransaction = jest.fn();
const mockUserFindUnique = jest.fn();
const mockEmit = jest.fn();
const mockTo = jest.fn((_room: string) => ({ emit: mockEmit }));
const mockSendPush = jest.fn().mockResolvedValue(undefined);

jest.mock('../core/database/client', () => ({
  prisma: {
    $transaction: (...args: any[]) => mockTransaction(...args),
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) }
  }
}));
jest.mock('../index', () => ({ io: { to: (room: string) => mockTo(room) } }));
jest.mock('../modules/notifications/push', () => ({ sendPushNotification: (...args: any[]) => mockSendPush(...args) }));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Transferencias — notifica a quien recibe (bug real corregido: antes era silenciosa)', () => {
  beforeEach(() => {
    mockTransaction.mockReset();
    mockUserFindUnique.mockReset();
    mockEmit.mockClear();
    mockTo.mockClear();
    mockSendPush.mockClear();
    mockUserFindUnique.mockResolvedValue({ name: 'Mateo' });
  });

  it('avisa por socket y por push a quien recibió la plata', async () => {
    mockTransaction.mockResolvedValue({ id: 'tx1', fromUserId: 'user1', toUserId: 'user2', amount: 500 });
    const { walletRouter } = await import('../modules/wallet/controller');
    const handler = getHandler(walletRouter, '/transfer');

    const req: any = { userId: 'user1', body: { toUserId: 'user2', amount: 500 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockTo).toHaveBeenCalledWith('user:user2');
    expect(mockEmit).toHaveBeenCalledWith('wallet_received', { fromUserId: 'user1', amount: 500, note: undefined });
    expect(mockSendPush).toHaveBeenCalledWith('user2', 'Recibiste un pago 💸', 'Mateo te envió $500', 'user1');
  });

  it('no notifica nada si la transferencia falla (saldo insuficiente)', async () => {
    mockTransaction.mockRejectedValue(new Error('Saldo insuficiente'));
    const { walletRouter } = await import('../modules/wallet/controller');
    const handler = getHandler(walletRouter, '/transfer');

    const req: any = { userId: 'user1', body: { toUserId: 'user2', amount: 500 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
