import { Server, Socket } from 'socket.io';
import { setTyping } from '../../core/database/redis';
import { prisma } from '../../core/database/client';
import { logger } from '../../core/utils/logger';

export function registerPresenceHandlers(io: Server, socket: Socket) {
  // Sistema "Sin spoofing de identidad": el userId se toma del JWT verificado
  // en la conexión (socket.userId), NUNCA del payload que manda el cliente.
  // Antes, cualquiera podía emitir {userId: "otro-usuario"} y hacerse pasar
  // por él en presencia o "escribiendo..." — corregido acá.
  const authenticatedUserId = (socket as any).userId;

  socket.on('typing', async ({ chatId }: { chatId: string }) => {
    await setTyping(chatId, authenticatedUserId);
    socket.to(chatId).emit('user_typing', { chatId, userId: authenticatedUserId });
  });

  socket.on('presence_update', async ({ isOnline }: { isOnline: boolean }) => {
    await updatePresence(authenticatedUserId, isOnline, socket);
  });

  // Sistema "Presencia real al desconectar": si el usuario cierra la pestaña,
  // pierde internet, o cierra la app sin avisar, esto lo marca offline de
  // verdad. Antes esto NO pasaba — el usuario quedaba "en línea" para siempre
  // hasta el próximo login, mostrando información falsa a sus contactos.
  socket.on('disconnect', async () => {
    try {
      await updatePresence(authenticatedUserId, false, socket);
    } catch (err) {
      logger.error('Error marcando offline al desconectar', err);
    }
  });
}

async function updatePresence(userId: string, isOnline: boolean, socket: Socket) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const ghostMode = (user?.settings as any)?.ghostMode;
  if (ghostMode) return; // Sistema #13: modo fantasma, no se emite ni actualiza lastSeen

  await prisma.user.update({
    where: { id: userId },
    data: { isOnline, lastSeen: new Date() }
  });
  socket.broadcast.emit('presence_changed', { userId, isOnline });
}
