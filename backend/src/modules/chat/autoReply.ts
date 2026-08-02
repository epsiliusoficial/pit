// Sistema "Auto-Respuesta / Modo Ausente" (nuevo): cuando tenés esto
// activado, la primera vez que alguien te escribe en un chat te contesta
// solo con tu mensaje configurado (tipo "estoy de vacaciones hasta el 5").
//
// Guardas reales contra el bug clásico de este tipo de feature (loop
// infinito si dos personas tienen auto-respuesta activada al mismo tiempo):
// 1. Nunca se auto-responde a un mensaje que ya es en sí una auto-respuesta
//    (se marca con `metadata.autoReply: true` y se corta ahí).
// 2. Como mucho una auto-respuesta por (chat, remitente) cada 3 horas —
//    en Redis con TTL — así no te contesta "estoy ausente" en cada mensaje
//    que te manden en la misma conversación.
//
// Se guarda en `User.settings` (Json que ya existía) bajo `autoReply` —
// cero migraciones nuevas de Postgres, mismo patrón que Carpetas y Canales.
//
// NOTA DE HONESTIDAD (consolidación E2E): el mensaje de auto-respuesta que
// esto crea NO pasa por el sobre E2E del cliente (nadie tipeó esto en un
// dispositivo, lo arma el propio servidor) — sigue cifrado en reposo con
// la clave del servidor (`encryptContent`), como estaba desde el principio.
// Es una asimetría real y consciente frente al resto del chat, que ahora
// es E2E real: quien lo lea del lado del cliente lo ve bien igual (el
// cliente sabe descifrar ambos formatos), pero técnicamente el servidor SÍ
// puede leer este mensaje puntual. Documentado acá para que no quede
// escondido — ver FEATURE_CONSOLIDATION.md, sección 🔴.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { redis } from '../../core/database/redis';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const autoReplyRouter = Router();
autoReplyRouter.use(authMiddleware);

const MAX_MESSAGE_LENGTH = 500;
const COOLDOWN_SECONDS = 3 * 60 * 60; // 3 horas por (chat, remitente)

autoReplyRouter.get('/', async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
  const autoReply = (user?.settings as any)?.autoReply || { enabled: false, message: '' };
  return res.json(autoReply);
});

autoReplyRouter.post('/', async (req: AuthRequest, res) => {
  const { enabled, message } = req.body;
  if (enabled && (typeof message !== 'string' || !message.trim())) {
    return res.status(400).json({ error: 'message requerido para activar la auto-respuesta' });
  }
  if (message && message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres` });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
  const settings = (user?.settings as any) || {};
  const autoReply = { enabled: !!enabled, message: message ? String(message).trim() : '' };
  await prisma.user.update({ where: { id: req.userId! }, data: { settings: { ...settings, autoReply } } });
  return res.json(autoReply);
});

// Usado por chat/controller.ts justo después de guardar un mensaje nuevo.
// Devuelve el texto a auto-responder, o null si no corresponde (no tiene
// activado, está en cooldown para este par chat+remitente, o el mensaje
// entrante ya era una auto-respuesta de otra persona).
export async function maybeGetAutoReply(
  recipientUserId: string,
  chatId: string,
  senderId: string,
  incomingWasAutoReply: boolean
): Promise<string | null> {
  if (incomingWasAutoReply) return null; // corta el loop de raíz

  const user = await prisma.user.findUnique({ where: { id: recipientUserId }, select: { settings: true } });
  const autoReply = (user?.settings as any)?.autoReply;
  if (!autoReply?.enabled || !autoReply.message) return null;

  const cooldownKey = `auto_reply_cooldown:${chatId}:${recipientUserId}:${senderId}`;
  const alreadySent = await redis.get(cooldownKey);
  if (alreadySent) return null;

  await redis.set(cooldownKey, '1', 'EX', COOLDOWN_SECONDS);
  return autoReply.message;
}
