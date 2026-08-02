// Barrido real de estados/historias vencidos, corre cada 60s.
import { prisma } from '../database/client';

export async function sweepExpiredStatuses() {
  const now = new Date();
  const result = await prisma.status.deleteMany({ where: { expiresAt: { lte: now } } });
  return result.count;
}
