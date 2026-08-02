// Sistema "Ubicación en Vivo" (nuevo): compartir tu posición en tiempo real
// dentro de un chat durante un tiempo acotado (15min/1h/8h — igual filosofía
// que "Mensajes que se autodestruyen" que ya tenías). Mismo patrón de
// autorización y de estado efímero en Redis que usan las llamadas grupales.
//
// Diseño, sin humo:
// - El estado ("quién está compartiendo, hasta cuándo") vive en Redis con
//   TTL exacto a la duración elegida — nunca en Postgres. Ubicación en vivo
//   es por definición temporal; guardarla en la base sería el bug clásico
//   de "dejar rastro permanente de algo que se supone que expira".
// - Solo miembros reales del chat pueden empezar o ver una ubicación en vivo
//   de ese chat — misma verificación de `ChatUser` que el resto del sistema.
// - Las actualizaciones de posición (`location_update`) NO se guardan en
//   ningún lado: se relayan en vivo por socket a la sala del chat y se
//   pisan sobre el mismo registro en Redis (siempre la última conocida).
//   Si alguien se conecta después de que empezó, `location_share_status` le
//   manda el último punto conocido de cada persona que sigue compartiendo.
// - El vencimiento real lo maneja el propio cliente (cuenta regresiva desde
//   `expiresAt`) y avisa con `location_share_stop` al cumplirse — la TTL de
//   Redis es la red de seguridad server-side si el cliente se cae sin avisar.
import { Server, Socket } from 'socket.io';
import { prisma } from '../../core/database/client';
import { redis } from '../../core/database/redis';
import { logger } from '../../core/utils/logger';

const ALLOWED_DURATIONS_SECONDS = [15 * 60, 60 * 60, 8 * 60 * 60]; // 15min, 1h, 8h — igual criterio que los efímeros
const sharerKey = (chatId: string, userId: string) => `live_location:${chatId}:${userId}`;
const chatSharersKey = (chatId: string) => `live_location_sharers:${chatId}`;

interface LiveLocationState {
  userId: string;
  chatId: string;
  lat: number;
  lng: number;
  startedAt: number;
  expiresAt: number;
}

async function isRealMember(userId: string, chatId: string) {
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId, chatId } }
  });
  return !!member;
}

// El wrapper de Redis de este proyecto (core/database/redis.ts) expone una
// interfaz reducida (get/set/del/getdel/incr/expire/lpush/rpop) — sin
// sadd/srem/smembers de sets nativos, a propósito, para que funcione igual
// con el fallback en memoria. Por eso la lista de "quién comparte ubicación
// en este chat" se guarda como un array JSON plano bajo una sola key, no
// como un Set de Redis.
async function getSharerIds(chatId: string): Promise<string[]> {
  const raw = await redis.get(chatSharersKey(chatId));
  return raw ? JSON.parse(raw) : [];
}

async function addSharerId(chatId: string, userId: string, ttl: number) {
  const ids = await getSharerIds(chatId);
  if (!ids.includes(userId)) ids.push(userId);
  await redis.set(chatSharersKey(chatId), JSON.stringify(ids), 'EX', ttl);
}

async function removeSharerId(chatId: string, userId: string) {
  const ids = (await getSharerIds(chatId)).filter((id) => id !== userId);
  if (ids.length === 0) {
    await redis.del(chatSharersKey(chatId));
  } else {
    await redis.set(chatSharersKey(chatId), JSON.stringify(ids), 'EX', 60 * 60 * 8);
  }
}

export function registerLiveLocationHandlers(io: Server, socket: Socket) {
  const userId = (socket as any).userId;

  socket.on('location_share_start', async ({ chatId, lat, lng, durationSeconds }: {
    chatId: string; lat: number; lng: number; durationSeconds: number;
  }) => {
    try {
      if (!(await isRealMember(userId, chatId))) {
        socket.emit('location_error', { error: 'No pertenecés a este chat' });
        return;
      }
      if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        socket.emit('location_error', { error: 'Coordenadas inválidas' });
        return;
      }
      const ttl = ALLOWED_DURATIONS_SECONDS.includes(durationSeconds) ? durationSeconds : ALLOWED_DURATIONS_SECONDS[0];

      const state: LiveLocationState = {
        userId, chatId, lat, lng, startedAt: Date.now(), expiresAt: Date.now() + ttl * 1000
      };
      await redis.set(sharerKey(chatId, userId), JSON.stringify(state), 'EX', ttl);
      await addSharerId(chatId, userId, ttl);

      io.to(chatId).emit('location_share_started', state);
      logger.info(`Usuario ${userId} empezó a compartir ubicación en vivo en el chat ${chatId} por ${ttl}s`);
    } catch (err) {
      logger.error('Error en location_share_start', err);
    }
  });

  // Actualización de posición mientras la persona se mueve. No revalida
  // membership en cada tick a propósito (sería una consulta a Postgres por
  // cada movimiento del GPS, varias veces por minuto) — la validación real
  // ya ocurrió en location_share_start, y solo se puede actualizar tu propio
  // registro (userId sale del socket autenticado, no del payload).
  socket.on('location_update', async ({ chatId, lat, lng }: { chatId: string; lat: number; lng: number }) => {
    try {
      const raw = await redis.get(sharerKey(chatId, userId));
      if (!raw) return; // no está compartiendo (venció o nunca empezó) — se ignora, no es un error
      const state: LiveLocationState = JSON.parse(raw);
      state.lat = lat;
      state.lng = lng;

      const remainingTtl = Math.max(1, Math.floor((state.expiresAt - Date.now()) / 1000));
      await redis.set(sharerKey(chatId, userId), JSON.stringify(state), 'EX', remainingTtl);

      io.to(chatId).emit('location_update', { chatId, userId, lat, lng });
    } catch (err) {
      logger.error('Error en location_update', err);
    }
  });

  socket.on('location_share_stop', async ({ chatId }: { chatId: string }) => {
    try {
      await redis.del(sharerKey(chatId, userId));
      await removeSharerId(chatId, userId);
      io.to(chatId).emit('location_share_stopped', { chatId, userId });
    } catch (err) {
      logger.error('Error en location_share_stop', err);
    }
  });

  // Al entrar a un chat, el cliente pide el estado actual (quién sigue
  // compartiendo ahora mismo y su último punto conocido) — útil para quien
  // se suma después de que alguien ya empezó a compartir.
  socket.on('location_share_status', async ({ chatId }: { chatId: string }) => {
    try {
      if (!(await isRealMember(userId, chatId))) return;
      const sharerIds: string[] = await getSharerIds(chatId);
      const active: LiveLocationState[] = [];
      for (const sharerId of sharerIds) {
        const raw = await redis.get(sharerKey(chatId, sharerId));
        if (raw) active.push(JSON.parse(raw));
        else await removeSharerId(chatId, sharerId); // se limpia solo si ya venció
      }
      socket.emit('location_share_status', { chatId, active });
    } catch (err) {
      logger.error('Error en location_share_status', err);
    }
  });
}
