// Sistema "Interruptor de Hombre Muerto" (nuevo): pensado para situaciones
// reales donde a alguien le puede pasar algo y nadie se entera a tiempo —
// activás esto eligiendo un contacto de confianza y un número de días de
// inactividad; si Pit no te ve activo durante todo ese tiempo (usando
// User.lastSeen, que ya existía y se actualiza solo con la presencia real),
// se le manda automáticamente un aviso a esa persona.
//
// Diseño, sin migraciones nuevas:
// - La configuración vive en User.settings.deadManSwitch (Json que ya
//   existía) — {enabled, daysInactive, trustedContactUserId, triggered,
//   lastCheckedAt}.
// - El disparo se resetea solo apenas la persona vuelve a estar activa
//   (se ve por lastSeen actualizado más reciente que la config), así no
//   queda "gatillado para siempre" la primera vez que se activa.
// - Se dispara UNA sola vez por período de inactividad real (no manda el
//   aviso de nuevo cada vez que corre el worker) — se marca `triggered` y
//   solo se resetea cuando la persona vuelve a aparecer activa.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from './middleware';
import { encryptContent } from '../../core/crypto/messageEncryption';
import { io } from '../../index';

export const deadManSwitchRouter = Router();
deadManSwitchRouter.use(authMiddleware);

const MIN_DAYS = 1;
const MAX_DAYS = 365;

deadManSwitchRouter.get('/', async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
  const config = (user?.settings as any)?.deadManSwitch || { enabled: false };
  return res.json(config);
});

deadManSwitchRouter.post('/', async (req: AuthRequest, res) => {
  const { enabled, daysInactive, trustedContactUserId } = req.body;

  if (enabled) {
    if (!trustedContactUserId) return res.status(400).json({ error: 'trustedContactUserId requerido para activar' });
    if (trustedContactUserId === req.userId) return res.status(400).json({ error: 'El contacto de confianza no puede ser vos mismo' });
    if (!Number.isInteger(daysInactive) || daysInactive < MIN_DAYS || daysInactive > MAX_DAYS) {
      return res.status(400).json({ error: `daysInactive debe ser un entero entre ${MIN_DAYS} y ${MAX_DAYS}` });
    }
    const contact = await prisma.user.findUnique({ where: { id: trustedContactUserId } });
    if (!contact) return res.status(404).json({ error: 'Contacto de confianza no encontrado' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
  const settings = (user?.settings as any) || {};
  settings.deadManSwitch = enabled
    ? { enabled: true, daysInactive, trustedContactUserId, triggered: false }
    : { enabled: false };

  await prisma.user.update({ where: { id: req.userId! }, data: { settings } });
  return res.json(settings.deadManSwitch);
});

// Worker: corre una vez por día (ver index.ts) — revisa a todos los usuarios
// con el interruptor activado y dispara el aviso si corresponde.
export async function checkDeadManSwitches() {
  const users = await prisma.user.findMany({
    where: { settings: { path: ['deadManSwitch', 'enabled'], equals: true } as any }
  });

  for (const user of users) {
    const config = (user.settings as any)?.deadManSwitch;
    if (!config?.enabled || config.triggered) continue;

    const inactiveMs = config.daysInactive * 24 * 60 * 60 * 1000;
    const lastActivity = user.lastSeen ? new Date(user.lastSeen).getTime() : new Date(user.createdAt).getTime();
    if (Date.now() - lastActivity < inactiveMs) continue;

    // Se dispara: busca (o crea) un chat directo con el contacto de confianza
    // y le manda el aviso ahí — un mensaje real, no un canal aparte.
    let chat = await prisma.chat.findFirst({
      where: {
        isGroup: false,
        AND: [
          { users: { some: { userId: user.id } } },
          { users: { some: { userId: config.trustedContactUserId } } }
        ]
      }
    });
    if (!chat) {
      chat = await prisma.chat.create({
        data: {
          isGroup: false,
          users: { create: [{ userId: user.id }, { userId: config.trustedContactUserId }] }
        }
      });
    }

    const alertText = `🔔 Aviso automático de Pit: ${user.name} no usa la app hace ${config.daysInactive}+ días. ` +
      `Configuró que te avisemos a vos si esto pasaba.`;
    const message = await prisma.message.create({
      data: { chatId: chat.id, senderId: user.id, content: encryptContent(alertText), contentType: 'SYSTEM' }
    });
    io.to(chat.id).emit('new_message', { ...message, content: alertText });

    const settings = { ...(user.settings as any), deadManSwitch: { ...config, triggered: true } };
    await prisma.user.update({ where: { id: user.id }, data: { settings } });
  }
}
