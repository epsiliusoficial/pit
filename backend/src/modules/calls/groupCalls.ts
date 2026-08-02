// Sistema "Llamadas Grupales Pit": extiende el modelo 1:1 de signaling.ts a
// N participantes usando topología mesh (cada peer conecta P2P con todos los
// demás). Esto es real y funciona bien hasta ~6-8 participantes por llamada
// (arriba de eso el ancho de banda de subida de cada cliente se vuelve el
// cuello de botella — es la misma limitación que tiene cualquier mesh WebRTC,
// incluida la que tenía Google Meet/Jitsi antes de migrar a SFU). Para más
// participantes hace falta un SFU (mediasoup/LiveKit), que es un sistema
// aparte y no lo vendo como si ya estuviera acá.
//
// Diseño:
// - El estado de "quién está en la llamada" vive en Redis con TTL (ephemeral,
//   no ensucia Postgres con presencia transitoria).
// - Solo miembros reales del chat (ChatUser) pueden crear o unirse a una
//   llamada grupal de ese chat — mismo control de autorización que ya usa
//   signaling.ts para 1:1.
// - El servidor NUNCA toca el media: solo relaya SDP/ICE por pares, igual que
//   el sistema 1:1. Cero costo de transcodificación para vos.
import { Server, Socket } from 'socket.io';
import { prisma } from '../../core/database/client';
import { redis } from '../../core/database/redis';
import { logger } from '../../core/utils/logger';

const CALL_TTL_SECONDS = 60 * 60 * 4; // una llamada "viva" expira sola a las 4hs si algo se cuelga
const MAX_PARTICIPANTS = 8;
const groupKey = (chatId: string) => `group_call:${chatId}`;
// Bug evitado: usar `redis.keys('group_call:*')` en cada disconnect para
// encontrar en qué llamada estaba el usuario escala mal (KEYS bloquea Redis
// en producción con muchas llamadas activas). En vez de eso mantenemos un
// índice inverso userId -> chatId activo, lectura O(1).
const activeCallOf = (userId: string) => `user_active_call:${userId}`;

interface GroupCallState {
  chatId: string;
  callType: 'audio' | 'video';
  startedBy: string;
  participants: string[]; // userIds
  startedAt: number;
}

async function getState(chatId: string): Promise<GroupCallState | null> {
  const raw = await redis.get(groupKey(chatId));
  return raw ? JSON.parse(raw) : null;
}

async function saveState(state: GroupCallState) {
  await redis.set(groupKey(state.chatId), JSON.stringify(state), 'EX', CALL_TTL_SECONDS);
}

async function isRealMember(userId: string, chatId: string) {
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId, chatId } }
  });
  return !!member;
}

export function registerGroupCallHandlers(io: Server, socket: Socket) {
  const userId = (socket as any).userId;

  // Inicia o se une a la llamada grupal de un chat. Idempotente: si ya hay
  // una llamada en curso en ese chat, te sumás a ella en vez de crear otra
  // (evita el bug clásico de "dos llamadas grupales paralelas en el mismo chat"
  // que confunde a todo el mundo sobre a cuál conectarse).
  socket.on('group_call_join', async ({ chatId, callType }: { chatId: string; callType: 'audio' | 'video' }) => {
    try {
      if (!chatId || !(await isRealMember(userId, chatId))) {
        socket.emit('call_error', { error: 'No pertenecés a este chat' });
        return;
      }

      let state = await getState(chatId);
      if (!state) {
        state = { chatId, callType: callType || 'video', startedBy: userId, participants: [], startedAt: Date.now() };
      }

      if (!state.participants.includes(userId)) {
        if (state.participants.length >= MAX_PARTICIPANTS) {
          socket.emit('call_error', { error: `La llamada ya tiene el máximo de ${MAX_PARTICIPANTS} participantes` });
          return;
        }
        state.participants.push(userId);
      }
      await saveState(state);
      await redis.set(activeCallOf(userId), chatId, 'EX', CALL_TTL_SECONDS);

      socket.join(`group_call:${chatId}`);

      // Al que entra le mandamos la lista de peers existentes (para que abra
      // una conexión mesh con cada uno). A los que ya estaban, les avisamos
      // del nuevo participante para que ellos inicien el offer hacia él.
      const existingPeers = state.participants.filter((id) => id !== userId);
      socket.emit('group_call_joined', { chatId, callType: state.callType, peers: existingPeers });
      socket.to(`group_call:${chatId}`).emit('group_call_peer_joined', { chatId, userId });

      logger.info(`Usuario ${userId} se unió a la llamada grupal del chat ${chatId} (${state.participants.length} participantes)`);
    } catch (err) {
      logger.error('Error en group_call_join', err);
    }
  });

  // Señalización mesh: mismos eventos que 1:1 pero dirigidos a un peer
  // específico dentro de la sala de la llamada grupal.
  socket.on('group_call_offer', ({ chatId, toUserId, sdp }: { chatId: string; toUserId: string; sdp: any }) => {
    io.to(`user:${toUserId}`).emit('group_call_offer', { chatId, fromUserId: userId, sdp });
  });

  socket.on('group_call_answer', ({ chatId, toUserId, sdp }: { chatId: string; toUserId: string; sdp: any }) => {
    io.to(`user:${toUserId}`).emit('group_call_answer', { chatId, fromUserId: userId, sdp });
  });

  socket.on('group_call_ice_candidate', ({ chatId, toUserId, candidate }: { chatId: string; toUserId: string; candidate: any }) => {
    io.to(`user:${toUserId}`).emit('group_call_ice_candidate', { chatId, fromUserId: userId, candidate });
  });

  socket.on('group_call_leave', async ({ chatId }: { chatId: string }) => {
    try {
      const state = await getState(chatId);
      if (!state) return;
      state.participants = state.participants.filter((id) => id !== userId);
      socket.leave(`group_call:${chatId}`);
      socket.to(`group_call:${chatId}`).emit('group_call_peer_left', { chatId, userId });
      await redis.del(activeCallOf(userId));

      if (state.participants.length === 0) {
        await redis.del(groupKey(chatId));
      } else {
        await saveState(state);
      }
    } catch (err) {
      logger.error('Error en group_call_leave', err);
    }
  });

  // Se limpia sola si el socket se cae sin avisar (cierre de app, corte de red).
  // O(1) vía el índice inverso — nunca escanea todas las llamadas activas.
  socket.on('disconnect', async () => {
    try {
      const chatId = await redis.get(activeCallOf(userId));
      if (!chatId) return;

      const state = await getState(chatId);
      if (!state) {
        await redis.del(activeCallOf(userId));
        return;
      }

      state.participants = state.participants.filter((id) => id !== userId);
      socket.to(`group_call:${chatId}`).emit('group_call_peer_left', { chatId, userId });
      await redis.del(activeCallOf(userId));

      if (state.participants.length === 0) {
        await redis.del(groupKey(chatId));
      } else {
        await saveState(state);
      }
    } catch (err) {
      logger.error('Error limpiando llamada grupal en disconnect', err);
    }
  });
}
