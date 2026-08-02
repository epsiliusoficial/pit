// Sistema "Resumen Diario" (nuevo): un solo pedido te resume TODO lo que
// pasó en tus chats en las últimas 24 horas, chat por chat — para cuando
// volvés de estar desconectado y tenés 40 chats con mensajes nuevos y cero
// ganas de leerlos uno por uno.
//
// Reusa el mismo motor de IA que ya existía (callOpenAI) y el mismo
// criterio de descifrado que el Resumidor por chat — la diferencia real es
// que este recorre TODOS los chats del usuario de una, arma un transcript
// separado por chat, y le pide a la IA un resumen agrupado.
//
// Guarda de costo real: cachea el último resumen en User.settings (Json que
// ya existía) por 15 minutos — así pedirlo de nuevo sin que haya pasado
// nada nuevo no vuelve a gastar una llamada a la API.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { callOpenAI } from './controller';

export const dailyDigestRouter = Router();
dailyDigestRouter.use(authMiddleware);

const CACHE_MS = 15 * 60 * 1000; // 15 minutos

dailyDigestRouter.get('/', async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
  const cached = (user?.settings as any)?.lastDigest;
  if (cached?.generatedAt && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_MS) {
    return res.json({ digest: cached.text, generatedAt: cached.generatedAt, cached: true });
  }
  return res.json({ digest: null, needsTranscript: true });
});

// Sistema "E2E real (fase 3)": ANTES este endpoint recorría TODOS los chats
// del usuario en la base y desciframba cada mensaje con la clave del
// servidor — imposible ahora, el contenido es un sobre E2E que el server no
// puede abrir. El resumen sigue existiendo: el CLIENTE arma el transcript
// (ya tiene cada mensaje descifrado localmente para mostrarlo en pantalla,
// de las últimas 24hs de sus chats) y lo manda acá solo para que la IA lo
// resuma — el servidor sigue sin ver un mensaje individual fuera de este
// transcript que el propio usuario decidió mandar.
dailyDigestRouter.post('/', async (req: AuthRequest, res) => {
  const { transcript } = req.body;
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return res.status(400).json({ error: 'transcript requerido — armalo en el cliente con tus mensajes ya descifrados' });
  }
  if (transcript.length > 40000) {
    return res.status(400).json({ error: 'transcript demasiado grande' });
  }

  try {
    const digest = await callOpenAI(
      'Te paso el historial de mensajes de las últimas 24hs de varios chats de un usuario, separados por chat con ' +
      'un encabezado "### nombre". Armá un resumen en español, agrupado por chat, con 1-3 puntos claros y breves ' +
      'por cada uno (solo lo importante: decisiones, preguntas pendientes, planes). No inventes nada que no esté.',
      transcript
    );

    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
    const settings = (user?.settings as any) || {};
    settings.lastDigest = { text: digest, generatedAt: new Date().toISOString() };
    await prisma.user.update({ where: { id: req.userId! }, data: { settings } });

    return res.json({ digest, generatedAt: settings.lastDigest.generatedAt, cached: false });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});
