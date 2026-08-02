// Barrido real de mensajes efímeros vencidos. Corre cada 10s y borra (soft-delete)
// los mensajes cuyo expiresAt ya pasó, notificando por socket para que desaparezcan
// también en pantalla de todos los que estén viendo el chat en ese momento.
import { prisma } from '../database/client';
import { io } from '../../index';

export async function sweepExpiredMessages() {
  const now = new Date();
  const expired = await prisma.message.findMany({
    where: { isEphemeral: true, isDeleted: false, expiresAt: { lte: now } }
  });
  for (const msg of expired) {
    await prisma.message.update({ where: { id: msg.id }, data: { isDeleted: true } });
    io.to(msg.chatId).emit('message_deleted', { id: msg.id });
  }
}
