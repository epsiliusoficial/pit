// Sistema "División de Gastos" (nuevo, tipo Splitwise adentro del chat): el
// asado, el Airbnb del viaje, el super de la previa — alguien lo paga todo
// y después divide el gasto entre los participantes. Cada uno salda su
// parte con un tap, y esa plata se mueve de verdad usando la Billetera que
// ya existía (mismas transacciones atómicas que ya usaba /wallet/transfer).
//
// Guardado en Chat.groupConfig.splitBills (mismo campo Json que ya usan
// Mensajes Fijados, Roles Personalizados, Notas Compartidas, etc.) —
// [{ id, description, totalAmount, paidBy, participants: [{userId, share,
// settled}], createdAt }]. El reparto es en partes iguales entre los
// participantes indicados (no incluye automáticamente a quien pagó, salvo
// que se lo agregue como participante también).
import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const splitBillRouter = Router();
splitBillRouter.use(authMiddleware);

splitBillRouter.post('/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const { description, totalAmount, participantUserIds } = req.body;

  if (!description || typeof description !== 'string') return res.status(400).json({ error: 'description requerida' });
  if (typeof totalAmount !== 'number' || totalAmount <= 0) return res.status(400).json({ error: 'totalAmount debe ser un número positivo' });
  if (!Array.isArray(participantUserIds) || participantUserIds.length === 0) {
    return res.status(400).json({ error: 'participantUserIds no puede estar vacío' });
  }

  const member = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  for (const participantId of participantUserIds) {
    const isMember = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: participantId, chatId } } });
    if (!isMember) return res.status(400).json({ error: `${participantId} no es miembro de este chat` });
  }

  const share = Math.round((totalAmount / participantUserIds.length) * 100) / 100;
  const bill = {
    id: crypto.randomBytes(8).toString('hex'),
    description,
    totalAmount,
    paidBy: req.userId,
    participants: participantUserIds.map((userId: string) => ({ userId, share, settled: userId === req.userId })),
    createdAt: new Date().toISOString()
  };

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  const groupConfig = { ...(chat?.groupConfig as any || {}) };
  groupConfig.splitBills = [...(groupConfig.splitBills || []), bill];
  await prisma.chat.update({ where: { id: chatId }, data: { groupConfig } });

  return res.status(201).json(bill);
});

splitBillRouter.get('/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const member = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  return res.json({ bills: (chat?.groupConfig as any)?.splitBills || [] });
});

splitBillRouter.post('/:chatId/:billId/settle', async (req: AuthRequest, res) => {
  const { chatId, billId } = req.params;

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  const groupConfig = { ...(chat?.groupConfig as any || {}) };
  const bills: any[] = groupConfig.splitBills || [];
  const bill = bills.find((b) => b.id === billId);
  if (!bill) return res.status(404).json({ error: 'Gasto no encontrado' });

  const participant = bill.participants.find((p: any) => p.userId === req.userId);
  if (!participant) return res.status(403).json({ error: 'No sos participante de este gasto' });
  if (participant.settled) return res.status(400).json({ error: 'Ya saldaste tu parte' });

  try {
    await prisma.$transaction(async (tx: any) => {
      const payerWallet = await tx.wallet.findUnique({ where: { userId: req.userId! } });
      if (!payerWallet || payerWallet.balance < participant.share) throw new Error('INSUFFICIENT_FUNDS');

      await tx.wallet.update({ where: { userId: req.userId! }, data: { balance: { decrement: participant.share } } });
      await tx.wallet.upsert({
        where: { userId: bill.paidBy },
        update: { balance: { increment: participant.share } },
        create: { userId: bill.paidBy, balance: participant.share }
      });
      await tx.transaction.create({
        data: { fromUserId: req.userId!, toUserId: bill.paidBy, amount: participant.share, note: `División de gasto: ${bill.description}` }
      });
    });
  } catch (err: any) {
    if (err.message === 'INSUFFICIENT_FUNDS') return res.status(400).json({ error: 'Saldo insuficiente para saldar tu parte' });
    throw err;
  }

  participant.settled = true;
  await prisma.chat.update({ where: { id: chatId }, data: { groupConfig } });

  return res.json({ settled: true, allSettled: bill.participants.every((p: any) => p.settled) });
});
