// Sistema nuevo "Recordatorios de mensajes" (snooze): en vez de perseguir que
// la gente se quede pegada a las notificaciones, esto ayuda a lo contrario —
// sacar un mensaje de encima AHORA con la certeza de que va a volver a
// aparecer arriba de todo, con push notification incluida, en el momento
// que uno elija (mismo patrón que "snooze" en Gmail/Slack). Gestión real de
// la bandeja, no un gancho de enganche.
//
// Se guarda en Redis (no en Postgres) para no requerir una migración de
// schema — mismo patrón que ya usan los links de invitación.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { redis } from '../../core/database/redis';
import { logger } from '../../core/utils/logger';

export const snoozeRouter = Router();
snoozeRouter.use(authMiddleware);

const SNOOZE_INDEX_KEY = 'snoozed_messages:index';
const MIN_SNOOZE_MS = 60 * 1000; // al menos 1 minuto en el futuro
const MAX_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // hasta 30 días

interface SnoozeEntry {
  messageId: string;
  userId: string;
  chatId: string;
  resurfaceAt: number; // epoch ms
}

async function readIndex(): Promise<SnoozeEntry[]> {
  const raw = await redis.get(SNOOZE_INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeIndex(entries: SnoozeEntry[]): Promise<void> {
  await redis.set(SNOOZE_INDEX_KEY, JSON.stringify(entries));
}

snoozeRouter.post('/:messageId', async (req: AuthRequest, res) => {
  const { messageId } = req.params;
  const { resurfaceAt } = req.body;

  const timestamp = Date.parse(resurfaceAt);
  if (Number.isNaN(timestamp)) return res.status(400).json({ error: 'resurfaceAt debe ser una fecha válida' });

  const delta = timestamp - Date.now();
  if (delta < MIN_SNOOZE_MS || delta > MAX_SNOOZE_MS) {
    return res.status(400).json({ error: 'resurfaceAt debe estar entre 1 minuto y 30 días en el futuro' });
  }

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) return res.status(404).json({ error: 'Mensaje no encontrado' });

  // Solo se puede posponer un mensaje de un chat al que se pertenece —
  // mismo chequeo de membresía que ya se aplica en el resto del sistema.
  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId: message.chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const entries = await readIndex();
  const withoutOld = entries.filter((e) => !(e.messageId === messageId && e.userId === req.userId));
  withoutOld.push({ messageId, userId: req.userId!, chatId: message.chatId, resurfaceAt: timestamp });
  await writeIndex(withoutOld);

  return res.json({ snoozed: true, messageId, resurfaceAt: new Date(timestamp).toISOString() });
});

snoozeRouter.get('/', async (req: AuthRequest, res) => {
  const entries = await readIndex();
  const mine = entries.filter((e) => e.userId === req.userId);
  return res.json(mine.map((e) => ({ ...e, resurfaceAt: new Date(e.resurfaceAt).toISOString() })));
});

snoozeRouter.delete('/:messageId', async (req: AuthRequest, res) => {
  const { messageId } = req.params;
  const entries = await readIndex();
  const filtered = entries.filter((e) => !(e.messageId === messageId && e.userId === req.userId));
  await writeIndex(filtered);
  return res.json({ cancelled: true });
});

/** Llamado por el worker periódico: resurfacea (avisa) los que ya llegaron a su hora. */
export async function processSnoozedMessages(
  onDue: (entry: SnoozeEntry) => Promise<void>
): Promise<void> {
  const entries = await readIndex();
  const now = Date.now();
  const due = entries.filter((e) => e.resurfaceAt <= now);
  if (due.length === 0) return;

  const remaining = entries.filter((e) => e.resurfaceAt > now);
  await writeIndex(remaining);

  for (const entry of due) {
    try {
      await onDue(entry);
    } catch (err) {
      logger.error('Error al resurfacear un mensaje pospuesto', err);
    }
  }
}
