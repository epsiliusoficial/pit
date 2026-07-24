// Sistema "Pit Pay" (idea original #116): saldo interno real, con transacciones
// atómicas en base de datos (usa $transaction de Prisma, así nunca queda un
// estado inconsistente si algo falla a mitad de camino). No mueve dinero real
// hacia afuera todavía — eso necesita tus credenciales de una pasarela real
// (Stripe/MercadoPago), que no vienen incluidas por razones obvias de seguridad.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const walletRouter = Router();
walletRouter.use(authMiddleware);

async function getOrCreateWallet(userId: string) {
  return prisma.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId, balance: 0 }
  });
}

walletRouter.get('/balance', async (req: AuthRequest, res) => {
  const wallet = await getOrCreateWallet(req.userId!);
  return res.json({ balance: wallet.balance });
});

// Carga de saldo de prueba (en producción esto se reemplaza por el webhook real
// de tu pasarela de pago, que acredita el saldo tras un pago confirmado).
walletRouter.post('/topup', async (req: AuthRequest, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount inválido' });
  const wallet = await prisma.wallet.upsert({
    where: { userId: req.userId! },
    update: { balance: { increment: amount } },
    create: { userId: req.userId!, balance: amount }
  });
  return res.json({ balance: wallet.balance });
});

walletRouter.post('/transfer', async (req: AuthRequest, res) => {
  const { toUserId, amount, note } = req.body;
  if (!toUserId || !amount || amount <= 0) return res.status(400).json({ error: 'toUserId y amount válidos requeridos' });
  if (toUserId === req.userId) return res.status(400).json({ error: 'No podés transferirte a vos mismo' });

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      // Sistema "Transferencia sin doble gasto" (bug real corregido): el patrón
      // anterior (findUnique → chequear en JS → update) tiene una condición de
      // carrera clásica de finanzas. Bajo Read Committed (el nivel por defecto
      // de Postgres), dos transferencias simultáneas desde la misma wallet
      // pueden leer el mismo saldo ANTES de que ninguna de las dos termine,
      // pasar ambas la validación, y dejar el saldo negativo (doble gasto).
      //
      // La corrección real: un solo UPDATE atómico con la condición de saldo
      // suficiente en el WHERE. Postgres garantiza que el chequeo y el
      // decremento pasan como una sola operación indivisible a nivel de fila
      // — no hay ventana de tiempo entre "leer" y "escribir" que otra
      // transacción pueda colarse.
      const debited = await tx.wallet.updateMany({
        where: { userId: req.userId!, balance: { gte: amount } },
        data: { balance: { decrement: amount } }
      });

      if (debited.count === 0) {
        throw new Error('Saldo insuficiente');
      }

      await tx.wallet.upsert({
        where: { userId: toUserId },
        update: { balance: { increment: amount } },
        create: { userId: toUserId, balance: amount }
      });
      return tx.transaction.create({
        data: { fromUserId: req.userId!, toUserId, amount, note }
      });
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

walletRouter.get('/history', async (req: AuthRequest, res) => {
  const transactions = await prisma.transaction.findMany({
    where: { OR: [{ fromUserId: req.userId! }, { toUserId: req.userId! }] },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  return res.json(transactions);
});
