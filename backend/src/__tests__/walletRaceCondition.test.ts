export {}; // fuerza scope de módulo (sin esto, choca con otros test files que también declaran getHandler)

const mockUpdateMany = jest.fn();
const mockUpsert = jest.fn();
const mockTxCreate = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    $transaction: (...args: any[]) => mockTransaction(...args)
  }
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema Pit Pay — fix de condición de carrera (doble gasto)', () => {
  beforeEach(() => {
    mockUpdateMany.mockReset();
    mockUpsert.mockReset();
    mockTxCreate.mockReset();
    mockTransaction.mockReset();

    // Simula cómo Prisma ejecuta el callback de $transaction con un "tx" que
    // expone los mismos métodos, para poder inspeccionar CÓMO se llama updateMany.
    mockTransaction.mockImplementation(async (callback: any) => {
      const tx = {
        wallet: { updateMany: mockUpdateMany, upsert: mockUpsert },
        transaction: { create: mockTxCreate }
      };
      return callback(tx);
    });
  });

  it('usa un UPDATE atómico con condición de saldo en el WHERE (no lee-luego-escribe)', async () => {
    const { walletRouter } = await import('../modules/wallet/controller');
    const handler = getHandler(walletRouter, '/transfer');

    mockUpdateMany.mockResolvedValue({ count: 1 }); // el update afectó 1 fila = tenía saldo
    mockUpsert.mockResolvedValue({});
    mockTxCreate.mockResolvedValue({ id: 'tx1' });

    const req: any = { userId: 'alice', body: { toUserId: 'bob', amount: 50 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await handler(req, res);

    // La prueba real de la corrección: el chequeo de saldo suficiente
    // (balance >= amount) está DENTRO del WHERE del UPDATE, no en un
    // findUnique separado — así Postgres lo garantiza atómico por fila.
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'alice', balance: { gte: 50 } },
      data: { balance: { decrement: 50 } }
    });
    expect(res.json).toHaveBeenCalled();
  });

  it('rechaza la transferencia si el UPDATE atómico no afectó ninguna fila (saldo insuficiente o carrera perdida)', async () => {
    const { walletRouter } = await import('../modules/wallet/controller');
    const handler = getHandler(walletRouter, '/transfer');

    // count: 0 significa que el WHERE (balance >= amount) no matcheó ninguna
    // fila — o no había saldo, o otra transacción concurrente ya lo gastó.
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const req: any = { userId: 'alice', body: { toUserId: 'bob', amount: 999999 } };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await handler(req, res);

    expect(mockUpsert).not.toHaveBeenCalled(); // nunca debe acreditarle nada a bob
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
