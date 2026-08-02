// Worker real: revisa cada 15s si hay mensajes programados cuya hora ya llegó, y los envía.
//
// Bug real corregido — condición de carrera: antes se leían todos los
// mensajes con `sent: false` y recién DESPUÉS de crear el Message se
// marcaban como enviados. Si corren dos instancias del server (o esta
// corrida se solapa con la siguiente por una consulta lenta), ambas podían
// leer el mismo mensaje pendiente y enviarlo dos veces. Ahora cada mensaje
// se "reclama" atómicamente con un updateMany condicionado a `sent: false`
// ANTES de crearlo — si otra instancia ya lo reclamó, count da 0 y se
// descarta, garantizando que un mensaje programado se envía una sola vez.
import { prisma } from '../database/client';
import { io } from '../../index';
import { decryptContent } from '../crypto/messageEncryption';

export async function processScheduledMessages() {
  const now = new Date();
  const due = await prisma.scheduledMessage.findMany({ where: { sent: false, sendAt: { lte: now } } });
  for (const item of due) {
    const claimed = await prisma.scheduledMessage.updateMany({
      where: { id: item.id, sent: false },
      data: { sent: true }
    });
    if (claimed.count === 0) continue; // otra instancia ya lo mandó primero

    // item.content ya viene cifrado desde que se programó (ver extras.ts /schedule),
    // con la misma clave maestra — se copia el ciphertext directo al Message real,
    // sin descifrar y volver a cifrar (mismo patrón que usa /forward).
    const message = await prisma.message.create({
      data: { chatId: item.chatId, senderId: item.senderId, content: item.content, contentType: 'TEXT' }
    });
    io.to(item.chatId).emit('new_message', { ...message, content: decryptContent(message.content) });
  }
}
