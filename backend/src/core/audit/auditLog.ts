// Sistema "Auditoría": función reutilizable para registrar acciones sensibles.
// Un solo lugar que garantiza el mismo formato para todos los eventos auditables.
import { prisma } from '../database/client';
import { logger } from '../utils/logger';

export type AuditAction =
  | 'LOGIN'
  | 'REGISTER'
  | 'USER_BANNED'
  | 'USER_VERIFIED'
  | 'ROLE_CHANGED'
  | 'MEMBER_REMOVED'
  | 'ACCOUNT_DELETED'
  | 'ADMIN_ACCESS';

export async function auditLog(params: {
  userId?: string;
  action: AuditAction;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        targetId: params.targetId,
        metadata: params.metadata as any,
        ip: params.ip
      }
    });
  } catch (err) {
    // La auditoría nunca debe tumbar la operación principal si falla al escribir.
    logger.error('Error escribiendo audit log', err);
  }
}
