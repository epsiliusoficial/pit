// Sistema "Purga de Papelera": borra DEFINITIVAMENTE (hard delete) los mensajes
// que llevan más de 30 días en la papelera. Corre una vez por día.
import { prisma } from '../database/client';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function purgeTrash() {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  const result = await prisma.message.deleteMany({
    where: { isDeleted: true, deletedAt: { lte: cutoff } }
  });
  return result.count;
}
