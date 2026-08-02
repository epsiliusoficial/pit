// Sistema "Aviso de Captura de Pantalla" (nuevo, estilo Snapchat/Signal): el
// cliente (móvil) detecta nativamente cuando alguien saca una captura de
// pantalla dentro de un chat, y avisa acá — el servidor no puede detectar
// una captura por sí solo (eso es 100% del sistema operativo del celular),
// pero sí puede hacer lo importante una vez que el cliente avisa: dejarlo
// registrado como un mensaje real y visible para todos los miembros, para
// que quien mandó contenido sensible (una foto de ver-una-vez, por ejemplo)
// se entere de verdad y no se quede pensando que nadie se dio cuenta.
//
// No confiable al 100% (ningún sistema de este tipo lo es, ni en apps
// nativas) — pero la señal real que agrega valor es la MISMA que ya usan
// apps grandes: avisar cuando el cliente honesto lo reporta, no pretender
// bloquear técnicamente la captura (imposible de garantizar de verdad).
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { io } from '../../index';
import { encryptContent } from '../../core/crypto/messageEncryption';

export const screenshotAlertRouter = Router();
screenshotAlertRouter.use(authMiddleware);

screenshotAlertRouter.post('/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const { messageId } = req.body;

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { name: true } });
  const alertText = `📸 ${user?.name || 'Alguien'} hizo una captura de pantalla de este chat.`;

  const message = await prisma.message.create({
    data: { chatId, senderId: req.userId!, content: encryptContent(alertText), contentType: 'SYSTEM' }
  });

  io.to(chatId).emit('screenshot_taken', {
    chatId,
    userId: req.userId,
    messageId: messageId || null,
    takenAt: new Date().toISOString()
  });
  io.to(chatId).emit('new_message', { ...message, content: alertText });

  return res.status(201).json({ recorded: true });
});
