// Sistema "Links de invitación": generás un link real, con token único y expiración,
// para que cualquiera se una a un grupo sin que lo tengas que agregar manualmente.
//
// Bug real corregido: `expiresInSeconds` venía directo del body sin validar y se
// pasaba tal cual a Redis EX. Un admin (con buena o mala intención, o por un typo
// en el cliente) podía mandar un número negativo (Redis rechaza el SET entero y
// la ruta explotaba con un 500 sin manejar), cero, texto no numérico (`NaN`), o
// un número gigante (invitación "para siempre" sin darse cuenta, quedando abierta
// por años). Ahora se valida que sea un entero positivo y se lo limita a un
// máximo razonable (30 días).
//
// Sistema nuevo "Invitaciones con límite de usos y revocación": antes un link de
// invitación era válido para cantidad ilimitada de personas hasta que expirase
// solo, y no había forma de cortarlo antes de tiempo si se filtraba (ej: se
// reenvía fuera del grupo). Ahora un admin puede: (1) limitar cuántas veces se
// puede usar un link (como los invite links de Discord/Telegram), y (2)
// revocarlo en cualquier momento, incluso si todavía no expiró ni se agotó.
import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { redis } from '../../core/database/redis';

export const inviteRouter = Router();
inviteRouter.use(authMiddleware);

const MIN_TTL_SECONDS = 60; // 1 minuto
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días
const DEFAULT_TTL_SECONDS = 86400; // 24hs
const MAX_USES_CAP = 10_000;

interface InviteData {
  chatId: string;
  maxUses: number | null;
  usesLeft: number | null;
  createdBy: string;
}

async function requireGroupAdmin(userId: string, chatId: string) {
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat || !chat.isGroup) return { ok: false as const, status: 400, error: 'Solo se pueden invitar a grupos' };

  const member = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId, chatId } } });
  if (!member || member.role !== 'ADMIN') return { ok: false as const, status: 403, error: 'Solo admins pueden gestionar invitaciones' };

  return { ok: true as const };
}

inviteRouter.post('/create/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const { expiresInSeconds, maxUses } = req.body;

  const check = await requireGroupAdmin(req.userId!, chatId);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  // Validación real del TTL: entero positivo, dentro de un rango razonable.
  let ttl = DEFAULT_TTL_SECONDS;
  if (expiresInSeconds !== undefined) {
    const parsed = Number(expiresInSeconds);
    if (!Number.isInteger(parsed) || parsed < MIN_TTL_SECONDS || parsed > MAX_TTL_SECONDS) {
      return res.status(400).json({
        error: `expiresInSeconds debe ser un entero entre ${MIN_TTL_SECONDS} y ${MAX_TTL_SECONDS}`
      });
    }
    ttl = parsed;
  }

  // Validación del límite de usos: opcional, entero positivo dentro de un tope.
  let usesLeft: number | null = null;
  if (maxUses !== undefined && maxUses !== null) {
    const parsedUses = Number(maxUses);
    if (!Number.isInteger(parsedUses) || parsedUses < 1 || parsedUses > MAX_USES_CAP) {
      return res.status(400).json({ error: `maxUses debe ser un entero entre 1 y ${MAX_USES_CAP}` });
    }
    usesLeft = parsedUses;
  }

  const token = crypto.randomBytes(12).toString('hex');
  const data: InviteData = { chatId, maxUses: usesLeft, usesLeft, createdBy: req.userId! };
  await redis.set(`invite:${token}`, JSON.stringify(data), 'EX', ttl);

  return res.json({ token, expiresIn: ttl, maxUses: usesLeft, link: `/join/${token}` });
});

// Sistema "Revocación de invitación": corta el link YA, sin esperar a que expire
// ni a que se agoten los usos. Solo un admin del mismo grupo puede revocarlo.
inviteRouter.delete('/:token', async (req: AuthRequest, res) => {
  const { token } = req.params;
  const raw = await redis.get(`invite:${token}`);
  if (!raw) return res.status(404).json({ error: 'Invitación no encontrada o ya expirada' });

  let data: InviteData;
  try {
    data = JSON.parse(raw);
  } catch {
    // Compatibilidad con invitaciones viejas guardadas como string plano (chatId).
    data = { chatId: raw, maxUses: null, usesLeft: null, createdBy: '' };
  }

  const check = await requireGroupAdmin(req.userId!, data.chatId);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  await redis.del(`invite:${token}`);
  return res.json({ revoked: true });
});

inviteRouter.post('/accept/:token', async (req: AuthRequest, res) => {
  const { token } = req.params;
  const raw = await redis.get(`invite:${token}`);
  if (!raw) return res.status(400).json({ error: 'Invitación inválida o expirada' });

  let data: InviteData;
  try {
    data = JSON.parse(raw);
  } catch {
    // Compatibilidad con invitaciones creadas antes de este cambio (guardaban
    // solo el chatId como string plano, sin límite de usos).
    data = { chatId: raw, maxUses: null, usesLeft: null, createdBy: '' };
  }

  const { chatId } = data;

  const existing = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (existing) return res.json({ alreadyMember: true, chatId });

  // Sistema "Solicitud de Unión con Aprobación" (nuevo): si el grupo tiene
  // requireApproval activado (ver join-requests.ts), unirse por invitación
  // ya no entra directo — queda pendiente hasta que un admin la apruebe.
  // Por defecto (requireApproval ausente/false) el comportamiento es
  // EXACTAMENTE el mismo de siempre: entra directo.
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if ((chat?.groupConfig as any)?.requireApproval) {
    const groupConfig = { ...(chat!.groupConfig as any) };
    const joinRequests: any[] = groupConfig.joinRequests || [];
    if (!joinRequests.some((r) => r.userId === req.userId)) {
      joinRequests.push({ userId: req.userId, requestedAt: new Date().toISOString() });
    }
    groupConfig.joinRequests = joinRequests;
    await prisma.chat.update({ where: { id: chatId }, data: { groupConfig } });
    return res.json({ pendingApproval: true, chatId });
  }

  // Si el link tiene límite de usos, se descuenta ANTES de aceptar — si ya
  // se agotó, la invitación queda inválida aunque todavía no haya expirado.
  if (data.usesLeft !== null) {
    if (data.usesLeft <= 0) return res.status(400).json({ error: 'Esta invitación ya alcanzó su límite de usos' });
    data.usesLeft -= 1;
    if (data.usesLeft <= 0) {
      await redis.del(`invite:${token}`);
    } else {
      // Mantiene el link vivo con el contador actualizado. Como nuestra
      // interfaz de cache no expone "SET conservando el TTL restante", para
      // links con usos limitados el corte real lo da el contador, no el
      // tiempo, así que renovamos con el TTL máximo como red de seguridad.
      await redis.set(`invite:${token}`, JSON.stringify(data), 'EX', MAX_TTL_SECONDS);
    }
  }

  await prisma.chatUser.create({ data: { userId: req.userId!, chatId, role: 'MEMBER' } });
  return res.json({ joined: true, chatId });
});
