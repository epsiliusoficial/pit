// Sistema "Llamadas Pit": señalización WebRTC real por Socket.io.
// Esto NO es un mock: intercambia SDP offer/answer e ICE candidates de verdad,
// que es exactamente lo que necesita cualquier librería WebRTC (navegador o
// react-native-webrtc) para establecer audio/video peer-to-peer.
// El audio/video en sí viaja directo entre los dos dispositivos (P2P), el
// servidor solo ayuda a que se "encuentren" al principio.
import { Server, Socket } from 'socket.io';
import { prisma } from '../../core/database/client';
import { redis } from '../../core/database/redis';
import { logger } from '../../core/utils/logger';

interface CallOffer {
  toUserId: string;
  fromUserId: string;
  chatId: string;
  sdp: any;
  callType: 'audio' | 'video';
}

const MAX_OFFERS_PER_MINUTE = 10;

export function registerCallHandlers(io: Server, socket: Socket) {
  const userId = (socket as any).userId;

  // Bug real corregido: antes se relayaba `call_offer` a CUALQUIER toUserId
  // sin verificar nada — cualquier usuario autenticado podía "llamar" a
  // cualquier otro (conocido el userId, adivinable o filtrado) sin ser
  // contacto ni compartir un chat con esa persona. Ahora se exige que tanto
  // quien llama como a quien llama sean miembros reales del chatId indicado
  // antes de avisarle al receptor que hay una llamada entrante. Además se
  // limita la cantidad de llamados por minuto para frenar el "spam de
  // llamadas" como forma de acoso.
  socket.on('call_offer', async (data: CallOffer) => {
    try {
      if (!data?.toUserId || !data?.chatId) return;

      const key = `call_offer_rate:${userId}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60);
      if (count > MAX_OFFERS_PER_MINUTE) {
        socket.emit('call_error', { error: 'Estás iniciando demasiadas llamadas muy rápido' });
        return;
      }

      const [callerMember, calleeMember] = await Promise.all([
        prisma.chatUser.findUnique({ where: { userId_chatId: { userId, chatId: data.chatId } } }),
        prisma.chatUser.findUnique({ where: { userId_chatId: { userId: data.toUserId, chatId: data.chatId } } })
      ]);
      if (!callerMember || !calleeMember) {
        logger.warn(`Llamada rechazada: ${userId} intentó llamar a ${data.toUserId} fuera de un chat compartido`);
        return;
      }

      io.to(`user:${data.toUserId}`).emit('call_incoming', { ...data, fromUserId: userId });
    } catch (err) {
      logger.error('Error procesando call_offer', err);
    }
  });

  // El receptor responde con su propio SDP
  socket.on('call_answer', ({ toUserId, sdp }: { toUserId: string; sdp: any }) => {
    io.to(`user:${toUserId}`).emit('call_answered', { sdp, fromUserId: userId });
  });

  // Intercambio de candidatos ICE (necesario para atravesar NAT en ambos lados)
  socket.on('ice_candidate', ({ toUserId, candidate }: { toUserId: string; candidate: any }) => {
    io.to(`user:${toUserId}`).emit('ice_candidate', { candidate, fromUserId: userId });
  });

  socket.on('call_end', ({ toUserId }: { toUserId: string }) => {
    io.to(`user:${toUserId}`).emit('call_ended', { fromUserId: userId });
  });

  socket.on('call_reject', ({ toUserId }: { toUserId: string }) => {
    io.to(`user:${toUserId}`).emit('call_rejected', { fromUserId: userId });
  });

  // Sistema "Compartir pantalla": técnicamente es una renegociación WebRTC —
  // el emisor reemplaza su track de video (getUserMedia → getDisplayMedia) y
  // manda un nuevo offer/answer. Estos eventos solo avisan el cambio de tipo
  // de stream para que la UI del otro lado muestre "Fulano está compartiendo
  // pantalla"; el SDP real de la renegociación sigue viajando por call_offer.
  socket.on('screen_share_start', ({ toUserId }: { toUserId: string }) => {
    io.to(`user:${toUserId}`).emit('screen_share_started', { fromUserId: userId });
  });

  socket.on('screen_share_stop', ({ toUserId }: { toUserId: string }) => {
    io.to(`user:${toUserId}`).emit('screen_share_stopped', { fromUserId: userId });
  });
}
