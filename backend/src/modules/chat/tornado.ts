// Sistema #1 "Tornado": entrega garantizada de mensajes.
// Orden de intento: Socket.io directo (lo maneja el cliente) -> REST (controller.ts)
// -> si la escritura en BD falla, se encola en Redis y un worker reintenta.
import { redis } from '../../core/database/redis';
import { prisma } from '../../core/database/client';
import { io } from '../../index';
import { decryptContent } from '../../core/crypto/messageEncryption';
import { sendPushNotification } from '../notifications/push';
import { logger } from '../../core/utils/logger';

const QUEUE_KEY = 'retry_queue';

export interface PendingMessage {
  chatId: string;
  senderId: string;
  content: string;
  contentType?: string;
  metadata?: any;
  replyToId?: string;
}

export async function queueRetry(msg: PendingMessage) {
  await redis.lpush(QUEUE_KEY, JSON.stringify(msg));
}

export async function processRetryQueue() {
  const raw = await redis.rpop(QUEUE_KEY);
  if (!raw) return null;
  const msg: PendingMessage = JSON.parse(raw);
  try {
    const message = await prisma.message.create({
      data: {
        chatId: msg.chatId,
        senderId: msg.senderId,
        content: msg.content,
        contentType: msg.contentType || 'TEXT',
        metadata: msg.metadata,
        replyToId: msg.replyToId
      }
    });

    // Bug real corregido: antes esto terminaba acá — el mensaje quedaba
    // guardado en la base pero nadie se enteraba en el momento. Todo el
    // punto de "entrega garantizada" es que el mensaje LLEGUE, no solo que
    // sobreviva en la base para cuando alguien recargue por casualidad.
    // Ahora, igual que en el camino directo (controller.ts /send), se
    // emite por socket a la sala del chat y se manda push a los demás
    // miembros.
    const plainContent = decryptContent(message.content);
    io.to(msg.chatId).emit('new_message', { ...message, content: plainContent });

    const otherMembers = await prisma.chatUser.findMany({ where: { chatId: msg.chatId, NOT: { userId: msg.senderId } } });
    const preview = plainContent.length > 100 ? plainContent.slice(0, 100) + '…' : plainContent;
    for (const m of otherMembers as any[]) {
      sendPushNotification(m.userId, 'Pit', preview, msg.senderId)
        .catch((e) => logger.error('Error enviando push desde retry queue', e));
    }

    return message;
  } catch {
    // Si sigue fallando, se re-encola al final para no bloquear el resto de la cola.
    await redis.lpush(QUEUE_KEY, raw);
    return null;
  }
}
