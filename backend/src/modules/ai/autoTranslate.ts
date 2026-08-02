// Sistema "Traducción Automática de Chat" (nuevo): a diferencia del
// traductor manual que ya existía (/api/ai/translate, texto suelto + idioma
// a mano cada vez), esto te deja guardar UNA VEZ tu idioma preferido y
// después traducir cualquier mensaje real del chat con un solo tap, sin
// volver a elegir el idioma — el caso de uso real es "tengo un grupo con
// gente que habla portugués y quiero ver todo en español sin pensarlo".
//
// Guardado, sin migraciones nuevas: la preferencia vive en `User.settings`
// (Json que ya existía) bajo `autoTranslate` — mismo patrón que Auto-Respuesta
// y Carpetas. La traducción en sí reusa `callOpenAI` del traductor manual
// que ya existía, cero código de IA duplicado.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { callOpenAI } from './controller';

export const autoTranslateRouter = Router();
autoTranslateRouter.use(authMiddleware);

autoTranslateRouter.get('/', async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
  const autoTranslate = (user?.settings as any)?.autoTranslate || { enabled: false, targetLanguage: null };
  return res.json(autoTranslate);
});

autoTranslateRouter.post('/', async (req: AuthRequest, res) => {
  const { enabled, targetLanguage } = req.body;
  if (enabled && (typeof targetLanguage !== 'string' || !targetLanguage.trim())) {
    return res.status(400).json({ error: 'targetLanguage requerido para activar la traducción automática' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
  const settings = (user?.settings as any) || {};
  settings.autoTranslate = { enabled: !!enabled, targetLanguage: targetLanguage || null };

  await prisma.user.update({ where: { id: req.userId! }, data: { settings } });
  return res.json(settings.autoTranslate);
});

// Traduce un mensaje real del chat al idioma guardado en tu preferencia —
// no hace falta mandar el idioma de nuevo cada vez. Requiere ser miembro
// real del chat (misma verificación que el resto del sistema).
// Sistema "E2E real (fase 3)": ANTES esto buscaba el mensaje en la base y lo
// desciframba con la clave del servidor — imposible ahora que el contenido
// es un sobre E2E que el server no puede abrir. La función sigue viva: el
// cliente YA tiene el texto plano (lo descifró localmente para mostrarlo en
// pantalla), así que ahora lo manda directo acá en vez de que el servidor
// vaya a buscarlo. Se sigue validando membresía real del chat antes de gastar
// la llamada a OpenAI, para no habilitar un traductor gratis a cualquiera.
autoTranslateRouter.post('/message/:chatId/:messageId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const { plaintext } = req.body;
  if (typeof plaintext !== 'string' || !plaintext.trim()) {
    return res.status(400).json({ error: 'plaintext requerido — el cliente ya lo descifró, mandalo acá' });
  }

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
  const autoTranslate = (user?.settings as any)?.autoTranslate;
  if (!autoTranslate?.enabled || !autoTranslate?.targetLanguage) {
    return res.status(400).json({ error: 'Activá la traducción automática y elegí un idioma primero' });
  }

  try {
    const translated = await callOpenAI(
      `Traducí el siguiente texto al idioma "${autoTranslate.targetLanguage}". Respondé solo con la traducción, sin explicaciones.`,
      plaintext
    );
    return res.json({ original: plaintext, translated, targetLanguage: autoTranslate.targetLanguage });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});
