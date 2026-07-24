// Sistema "Notificaciones Push reales": usa el estándar Web Push (el mismo que
// usan Gmail, Twitter, etc. en el navegador). No es un mock: firma criptográfica
// VAPID real y envío real al endpoint del navegador de cada usuario.
import { Router } from 'express';
import webpush from 'web-push';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { shouldNotify } from '../social/focus';
import { logger } from '../../core/utils/logger';

export const pushRouter = Router();
pushRouter.use(authMiddleware);

// Las claves VAPID se generan UNA vez con `npx web-push generate-vapid-keys`
// y se guardan en el .env. Son necesarias para que el navegador confíe en tu servidor.
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:admin@pit.chat', VAPID_PUBLIC, VAPID_PRIVATE);
}

pushRouter.get('/vapid-public-key', (_req, res) => {
  return res.json({ publicKey: VAPID_PUBLIC });
});

// El navegador del usuario se suscribe y nos manda su "endpoint" único.
//
// Bug de seguridad corregido (mismo patrón que ya se arregló en
// user.controller.ts): esta ruta pisaba TODO el JSON de `settings` con un
// objeto que solo tenía `pushSubscription`. Como el 2FA guarda su secret en
// `settings.totp`, cualquier usuario que simplemente activara las
// notificaciones push perdía su 2FA sin darse cuenta (y de paso su tema,
// idioma, modo fantasma, etc.) — no hacía falta ningún ataque, pasaba solo
// con usar la app normalmente. Ahora se hace merge en vez de reemplazo total.
pushRouter.post('/subscribe', async (req: AuthRequest, res) => {
  const { subscription } = req.body;
  if (!subscription || typeof subscription !== 'object' || typeof subscription.endpoint !== 'string') {
    return res.status(400).json({ error: 'subscription inválida (falta endpoint)' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { settings: true } });
  const currentSettings = (user?.settings && typeof user.settings === 'object') ? user.settings as Record<string, any> : {};

  await prisma.user.update({
    where: { id: req.userId },
    data: { settings: { ...currentSettings, pushSubscription: subscription } }
  });
  return res.json({ subscribed: true });
});

// Función real de envío, para usar desde otros módulos (ej: al llegar un mensaje nuevo).
export async function sendPushNotification(userId: string, title: string, body: string, senderId?: string) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return; // no configurado, se omite silenciosamente

  // Sistema "Modo Concentración": si el receptor lo activó y el emisor no está
  // en su lista de permitidos, la notificación real no se envía.
  if (senderId) {
    const allowed = await shouldNotify(userId, senderId);
    if (!allowed) return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const subscription = (user?.settings as any)?.pushSubscription;
  if (!subscription) return;

  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body }));
  } catch (err) {
    logger.error('Error enviando push', err);
  }
}
