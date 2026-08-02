import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { registerPresenceHandlers } from '../../modules/chat/presence';
import { registerCallHandlers } from '../../modules/calls/signaling';
import { registerGroupCallHandlers } from '../../modules/calls/groupCalls';
import { registerLiveLocationHandlers } from '../../modules/chat/liveLocation';
import { logger } from '../../core/utils/logger';
import { getJwtSecret } from '../../core/utils/jwtSecret';
import { prisma } from '../../core/database/client';

export function registerSocketHandlers(io: Server) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth requerida'));
    try {
      const payload = jwt.verify(token, getJwtSecret()) as { userId: string };
      (socket as any).userId = payload.userId;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId;
    logger.info(`Usuario conectado: ${userId}`);

    // Sala personal: permite mandarle eventos a ESTE usuario en particular
    // (ej: "tu mensaje pospuesto volvió") sin depender de que esté mirando
    // un chat puntual en ese momento.
    socket.join(`user:${userId}`);

    // Sistema "Autorización de salas" (vulnerabilidad corregida): antes, cualquier
    // usuario autenticado podía hacer join_room con CUALQUIER chatId (el propio,
    // el de otro, uno adivinado) y a partir de ahí recibir en tiempo real todos los
    // 'new_message', 'message_edited', etc. de un chat ajeno — el JWT solo probaba
    // que el socket era un usuario válido, no que ese usuario perteneciera a esa
    // sala. Ahora se verifica membresía real contra ChatUser antes de unirse.
    socket.on('join_room', async (chatId: string) => {
      try {
        if (typeof chatId !== 'string' || !chatId) return;
        const member = await prisma.chatUser.findUnique({
          where: { userId_chatId: { userId, chatId } }
        });
        if (!member) {
          logger.warn(`Usuario ${userId} intentó unirse a un chat ajeno: ${chatId}`);
          return;
        }
        socket.join(chatId);
      } catch (e) {
        logger.error('Error verificando membresía en join_room', e);
      }
    });

    socket.on('leave_room', (chatId: string) => {
      socket.leave(chatId);
    });

    registerPresenceHandlers(io, socket);
    registerCallHandlers(io, socket);
    registerGroupCallHandlers(io, socket);
    registerLiveLocationHandlers(io, socket);

    socket.on('disconnect', () => {
      logger.info(`Usuario desconectado: ${userId}`);
    });
  });
}
