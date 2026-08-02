// Sistema "Botón de Emergencia (SOS)" (nuevo): distinto del Interruptor de
// Hombre Muerto (que se dispara SOLO, después de días de inactividad) —
// esto es el botón que apretás VOS, en el momento, cuando algo está
// pasando de verdad. Un tap manda un mensaje real con tu ubicación actual a
// todos tus contactos de emergencia configurados, de una.
//
// Guardado en User.settings.emergencyContacts (array de userIds, mismo
// patrón Json que ya usan Auto-Respuesta/Traducción/Pánico/Bóveda). Sin
// límite de "una vez por día" como el Interruptor de Hombre Muerto —
// una emergencia real puede repetirse, y frenar el botón sería peor que
// mandar un aviso de más.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { encryptContent } from '../../core/crypto/messageEncryption';
import { io } from '../../index';

export const sosRouter = Router();
sosRouter.use(authMiddleware);

const MAX_CONTACTS = 10;

sosRouter.post('/contacts', async (req: AuthRequest, res) => {
  const { contactUserIds } = req.body;
  if (!Array.isArray(contactUserIds) || contactUserIds.length === 0 || contactUserIds.length > MAX_CONTACTS) {
    return res.status(400).json({ error: `contactUserIds debe tener entre 1 y ${MAX_CONTACTS} elementos` });
  }
  if (contactUserIds.includes(req.userId)) return res.status(400).json({ error: 'No podés ser tu propio contacto de emergencia' });

  const found = await prisma.user.findMany({ where: { id: { in: contactUserIds } } });
  if (found.length !== contactUserIds.length) return res.status(404).json({ error: 'Uno o más contactos no existen' });

  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
  const settings = (user?.settings as any) || {};
  settings.emergencyContacts = contactUserIds;

  await prisma.user.update({ where: { id: req.userId! }, data: { settings } });
  return res.json({ emergencyContacts: contactUserIds });
});

sosRouter.get('/contacts', async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
  return res.json({ emergencyContacts: (user?.settings as any)?.emergencyContacts || [] });
});

sosRouter.post('/trigger', async (req: AuthRequest, res) => {
  const { latitude, longitude } = req.body;

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  const emergencyContacts: string[] = (user?.settings as any)?.emergencyContacts || [];
  if (emergencyContacts.length === 0) {
    return res.status(400).json({ error: 'No configuraste contactos de emergencia todavía' });
  }

  const hasLocation = typeof latitude === 'number' && typeof longitude === 'number';
  const locationText = hasLocation
    ? `\nUbicación: https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`
    : '';
  const alertText = `🆘 ALERTA DE EMERGENCIA: ${user?.name} activó el botón SOS.${locationText}`;

  const notifiedChatIds: string[] = [];
  for (const contactId of emergencyContacts) {
    let chat = await prisma.chat.findFirst({
      where: { isGroup: false, AND: [{ users: { some: { userId: req.userId! } } }, { users: { some: { userId: contactId } } }] }
    });
    if (!chat) {
      chat = await prisma.chat.create({
        data: { isGroup: false, users: { create: [{ userId: req.userId! }, { userId: contactId }] } }
      });
    }
    const message = await prisma.message.create({
      data: { chatId: chat.id, senderId: req.userId!, content: encryptContent(alertText), contentType: 'SYSTEM' }
    });
    io.to(chat.id).emit('new_message', { ...message, content: alertText });
    io.to(chat.id).emit('sos_triggered', { chatId: chat.id, userId: req.userId, latitude, longitude });
    notifiedChatIds.push(chat.id);
  }

  return res.json({ triggered: true, contactsNotified: emergencyContacts.length, chatIds: notifiedChatIds });
});
