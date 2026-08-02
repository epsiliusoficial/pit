// Sistema "Código de Seguridad" (nuevo, estilo Signal/WhatsApp): te deja
// verificar de verdad que estás hablando con quien creés que estás
// hablando, y — más importante todavía — te avisa si la clave pública de
// esa persona CAMBIÓ desde la última vez que verificaste, que es la señal
// clásica de un ataque man-in-the-middle o de una cuenta comprometida.
//
// Diseño, sin inventar tablas nuevas de Postgres:
// - El "código de seguridad" es un fingerprint determinístico derivado de
//   AMBAS claves públicas (ya existen en User.publicKey, cifrado E2E que ya
//   tenía este proyecto) — mismo par de claves = mismo código siempre, sin
//   importar quién lo calcule de los dos lados.
// - Se calcula con SHA-256 sobre las dos claves ordenadas alfabéticamente
//   (para que dé lo mismo si lo pide A sobre B o B sobre A) y se muestra
//   como grupos de dígitos, igual que el "número de seguridad" de Signal —
//   pensado para comparar de palabra o en persona, no para copiar y pegar
//   a ciegas.
// - "Verificar" guarda el hash de la clave pública de la otra persona EN
//   ESE MOMENTO bajo User.settings.verifiedContacts (Json que ya existía,
//   mismo patrón que Auto-Respuesta/Traducción). La próxima vez que se
//   consulte, si la clave pública real ya no coincide con la que quedó
//   guardada, se marca `keyChanged: true` — la alerta real de "cuidado,
//   esto cambió" en vez de mostrar el código nuevo como si nada.
import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from './middleware';

export const safetyNumberRouter = Router();
safetyNumberRouter.use(authMiddleware);

function keyHash(publicKey: string): string {
  return crypto.createHash('sha256').update(publicKey).digest('hex');
}

// Deriva un código de seguridad legible (grupos de 5 dígitos) a partir de
// las dos claves públicas — ordenadas para que A-sobre-B y B-sobre-A den
// exactamente el mismo resultado.
export function computeSafetyNumber(publicKeyA: string, publicKeyB: string): string {
  const [first, second] = [publicKeyA, publicKeyB].sort();
  const digest = crypto.createHash('sha256').update(`${first}|${second}`).digest();
  // Se toma el hash como un número grande y se pasa a dígitos decimales,
  // después se agrupa de a 5 para que sea más fácil de leer y comparar en
  // voz alta — mismo espíritu que el número de seguridad de Signal.
  const asDigits = BigInt('0x' + digest.toString('hex')).toString().padStart(60, '0').slice(0, 60);
  return asDigits.match(/.{1,5}/g)!.join(' ');
}

async function getOtherUser(otherUserId: string) {
  return prisma.user.findUnique({ where: { id: otherUserId }, select: { id: true, publicKey: true, name: true } });
}

safetyNumberRouter.get('/:otherUserId', async (req: AuthRequest, res) => {
  const { otherUserId } = req.params;
  if (otherUserId === req.userId) return res.status(400).json({ error: 'No aplica con vos mismo' });

  const me = await prisma.user.findUnique({ where: { id: req.userId! }, select: { publicKey: true, settings: true } });
  const other = await getOtherUser(otherUserId);
  if (!me || !other) return res.status(404).json({ error: 'Usuario no encontrado' });

  const safetyNumber = computeSafetyNumber(me.publicKey, other.publicKey);
  const verifiedContacts = (me.settings as any)?.verifiedContacts || {};
  const verifiedHash = verifiedContacts[otherUserId];
  const currentHash = keyHash(other.publicKey);

  return res.json({
    safetyNumber,
    otherUserName: other.name,
    verified: verifiedHash === currentHash,
    // Solo tiene sentido "cambió" si ANTES habías verificado algo distinto —
    // nunca haber verificado no es lo mismo que un cambio sospechoso.
    keyChanged: !!verifiedHash && verifiedHash !== currentHash
  });
});

safetyNumberRouter.post('/:otherUserId/verify', async (req: AuthRequest, res) => {
  const { otherUserId } = req.params;
  if (otherUserId === req.userId) return res.status(400).json({ error: 'No aplica con vos mismo' });

  const other = await getOtherUser(otherUserId);
  if (!other) return res.status(404).json({ error: 'Usuario no encontrado' });

  const me = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
  const settings = (me?.settings as any) || {};
  settings.verifiedContacts = { ...(settings.verifiedContacts || {}), [otherUserId]: keyHash(other.publicKey) };

  await prisma.user.update({ where: { id: req.userId! }, data: { settings } });
  return res.json({ verified: true });
});
