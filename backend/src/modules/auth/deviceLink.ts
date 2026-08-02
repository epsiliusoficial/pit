// Sistema "Vinculación de Dispositivo" (nuevo, cierra el gap real de
// multi-dispositivo del E2E): sin esto, la clave privada de cada usuario
// vive solo en el localStorage del navegador donde se registró — entrar
// desde otro dispositivo significa perder el historial para siempre, algo
// inaceptable para un producto real (WhatsApp/Signal resuelven esto con
// "vincular dispositivo").
//
// Cómo es seguro sin que el servidor vea nunca la clave privada real:
// 1. El dispositivo NUEVO genera un par de claves EFÍMERO (solo para este
//    vínculo) y lo muestra como código/QR junto a un linkId random.
// 2. El dispositivo YA VINCULADO escanea/ingresa ese código, arma un
//    secreto compartido por ECDH (nacl.box.before) entre su clave real y
//    la pública efímera del nuevo dispositivo, y cifra SU clave privada
//    real con ese secreto — el servidor solo recibe ese blob cifrado.
// 3. El dispositivo nuevo hace `claim` UNA sola vez (uso único, vía
//    getdel de Redis) del blob, arma el mismo secreto por ECDH con su
//    clave efímera + la pública real del otro dispositivo, y descifra
//    la clave privada real — recién ahí la guarda localmente.
//
// El servidor participa como mensajero ciego: solo relaciona linkId con
// userId (para que nadie vincule un dispositivo a una cuenta ajena) y
// guarda el blob cifrado con TTL corto de un solo uso.
import { Router } from 'express';
import crypto from 'crypto';
import { AuthRequest, authMiddleware } from './middleware';
import { redis } from '../../core/database/redis';

export const deviceLinkRouter = Router();
deviceLinkRouter.use(authMiddleware);

const LINK_TTL_SECONDS = 5 * 60; // 5 minutos: tiempo real para escanear un QR, no más

function linkKey(linkId: string) {
  return `devicelink:${linkId}`;
}

// El dispositivo NUEVO reserva un linkId, atado a su propia cuenta.
deviceLinkRouter.post('/start', async (req: AuthRequest, res) => {
  const linkId = crypto.randomBytes(16).toString('hex');
  await redis.set(linkKey(linkId), JSON.stringify({ userId: req.userId, status: 'pending' }), 'EX', LINK_TTL_SECONDS);
  return res.json({ linkId, expiresInSeconds: LINK_TTL_SECONDS });
});

// El dispositivo YA VINCULADO entrega el blob cifrado (nunca la clave en
// claro) para ese linkId — se valida que sea el mismo usuario, para que
// nadie use su sesión para "vincular" el dispositivo de otra persona.
deviceLinkRouter.post('/:linkId/deliver', async (req: AuthRequest, res) => {
  const { linkId } = req.params;
  const { ciphertext, nonce, senderPublicKey } = req.body;
  if (!ciphertext || !nonce || !senderPublicKey) {
    return res.status(400).json({ error: 'ciphertext, nonce y senderPublicKey requeridos' });
  }

  const raw = await redis.get(linkKey(linkId));
  if (!raw) return res.status(404).json({ error: 'Código vencido o inválido — generá uno nuevo' });
  const pending = JSON.parse(raw);
  if (pending.userId !== req.userId) return res.status(403).json({ error: 'Este código no es de tu cuenta' });
  if (pending.status !== 'pending') return res.status(409).json({ error: 'Este código ya se usó' });

  await redis.set(
    linkKey(linkId),
    JSON.stringify({ userId: req.userId, status: 'delivered', ciphertext, nonce, senderPublicKey }),
    'EX',
    LINK_TTL_SECONDS
  );
  return res.json({ delivered: true });
});

// El dispositivo NUEVO reclama el blob — de un solo uso (getdel), para que
// ni siquiera alguien con acceso a Redis en esa ventana de 5 minutos pueda
// leerlo dos veces.
deviceLinkRouter.get('/:linkId/claim', async (req: AuthRequest, res) => {
  const { linkId } = req.params;
  const raw = await redis.getdel(linkKey(linkId));
  if (!raw) return res.status(404).json({ error: 'Todavía no se entregó, o ya se reclamó, o venció' });
  const data = JSON.parse(raw);
  if (data.userId !== req.userId) return res.status(403).json({ error: 'Este código no es de tu cuenta' });
  if (data.status !== 'delivered') return res.status(409).json({ error: 'Todavía no lo confirmó el otro dispositivo' });

  return res.json({ ciphertext: data.ciphertext, nonce: data.nonce, senderPublicKey: data.senderPublicKey });
});
