// Sistema "Recordatorios Personales" (nuevo): "recordame X el viernes a las
// 5" — sin elegir ningún chat, sin mandárselo a nadie. Reusa 100% el motor
// de Mensajes Programados que ya existía (ScheduledMessage + el worker que
// ya corre cada 15s) — lo único nuevo es EL DESTINO: en vez de mandarlo a
// un chat con otra persona, se manda a un chat "Notas para mí" que se crea
// una sola vola por usuario (isGroup:false, un solo miembro: vos mismo).
// Cuando llega la hora, el worker existente lo entrega ahí como un mensaje
// real, con notificación push incluida (mismo camino que cualquier mensaje).
//
// NOTA DE HONESTIDAD (consolidación E2E): el texto del recordatorio lo
// procesa el propio servidor (tiene que saber la hora y el contenido para
// poder entregarlo), así que sigue cifrado en reposo con la clave del
// servidor, no con el sobre E2E del chat — aunque el destino sea un chat
// "solo yo", el servidor sí puede leer este mensaje puntual en el momento
// de crearlo. Es el mismo tipo de trade-off que Time Capsule, pero acá se
// mantiene porque el contenido nunca sale de la cuenta del propio usuario.
// Ver FEATURE_CONSOLIDATION.md, sección 🔴.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { encryptContent, decryptContent } from '../../core/crypto/messageEncryption';

export const remindersRouter = Router();
remindersRouter.use(authMiddleware);

const MAX_DELAY_MS = 1000 * 60 * 60 * 24 * 365 * 2; // 2 años

async function getOrCreateSelfChat(userId: string) {
  let chat = await prisma.chat.findFirst({
    where: { isGroup: false, name: '__self_notes__', users: { every: { userId } } }
  });
  if (!chat) {
    chat = await prisma.chat.create({
      data: { isGroup: false, name: '__self_notes__', users: { create: [{ userId }] } }
    });
  }
  return chat;
}

remindersRouter.post('/', async (req: AuthRequest, res) => {
  const { content, remindAt } = req.body;
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content (no vacío) es requerido' });
  }
  if (!remindAt) return res.status(400).json({ error: 'remindAt es requerido' });

  const parsed = new Date(remindAt);
  if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'remindAt no es una fecha válida' });
  const delay = parsed.getTime() - Date.now();
  if (delay <= 0) return res.status(400).json({ error: 'remindAt tiene que ser una fecha futura' });
  if (delay > MAX_DELAY_MS) return res.status(400).json({ error: 'remindAt no puede estar a más de 2 años' });

  const selfChat = await getOrCreateSelfChat(req.userId!);
  const reminder = await prisma.scheduledMessage.create({
    data: { chatId: selfChat.id, senderId: req.userId!, content: encryptContent(`⏰ ${content}`), sendAt: parsed }
  });

  return res.status(201).json({ id: reminder.id, remindAt: parsed.toISOString() });
});

remindersRouter.get('/', async (req: AuthRequest, res) => {
  const selfChat = await prisma.chat.findFirst({
    where: { isGroup: false, name: '__self_notes__', users: { every: { userId: req.userId! } } }
  });
  if (!selfChat) return res.json({ reminders: [] });

  const pending = await prisma.scheduledMessage.findMany({
    where: { chatId: selfChat.id, senderId: req.userId!, sent: false },
    orderBy: { sendAt: 'asc' }
  });

  return res.json({
    reminders: pending.map((r: any) => ({ id: r.id, content: decryptContent(r.content), remindAt: r.sendAt }))
  });
});

remindersRouter.delete('/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const reminder = await prisma.scheduledMessage.findUnique({ where: { id } });
  if (!reminder || reminder.senderId !== req.userId) {
    return res.status(403).json({ error: 'No podés borrar este recordatorio' });
  }
  if (reminder.sent) return res.status(400).json({ error: 'Este recordatorio ya se entregó' });

  await prisma.scheduledMessage.delete({ where: { id } });
  return res.json({ deleted: true });
});
