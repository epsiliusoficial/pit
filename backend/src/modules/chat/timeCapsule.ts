// Sistema "Cápsulas del Tiempo" (nuevo): mandás un mensaje HOY que queda
// bloqueado de verdad hasta una fecha futura que vos elegís — para un
// cumpleaños, un aniversario, "para abrir cuando..." — y nadie, ni el
// remitente, puede leer el contenido antes de esa fecha.
//
// Diseño, sin inventar tablas nuevas de Postgres:
// - La cápsula es un Message normal con contentType 'TIME_CAPSULE' y el
//   contenido real cifrado en `content` (mismo cifrado que cualquier
//   mensaje) — la fecha de apertura y el estado viven en `metadata`
//   (columna JSON que ya existía), mismo patrón que Eventos y Mensajes de Voz.
// - La app NUNCA manda el contenido descifrado antes de tiempo: el
//   endpoint de apertura valida `unlockAt` contra la hora real del
//   servidor (Date.now()), no contra nada que mande el cliente — así
//   nadie puede "abrir antes" manipulando su reloj local.
// - El mensaje que llega en tiempo real (`new_message` por socket) nunca
//   lleva el contenido real, solo el aviso "🔒 Cápsula del tiempo — se abre
//   el <fecha>" — el contenido de verdad solo sale por GET /open, y recién
//   cuando ya pasó unlockAt.
// - Se registra quién la abrió y cuándo en metadata.openedBy (útil para
//   cápsulas grupales: "Juana ya la abrió, vos todavía no").
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { decryptContent } from '../../core/crypto/messageEncryption';

export const timeCapsuleRouter = Router();
timeCapsuleRouter.use(authMiddleware);

async function requireMembership(userId: string, chatId: string) {
  return prisma.chatUser.findUnique({ where: { userId_chatId: { userId, chatId } } });
}

timeCapsuleRouter.post('/:chatId', async (req: AuthRequest, res) => {
  // Sistema "E2E real (fase 3)": Time Capsule dependía de que el SERVIDOR
  // tuviera el texto plano para poder "guardarlo bloqueado" y soltarlo
  // recién en unlockAt — es lo opuesto a E2E real (donde el server nunca
  // tiene el texto plano de nadie). No es un bug puntual, es un conflicto
  // de diseño de fondo: por eso se corta acá con un aviso claro. Un
  // rediseño real necesitaría que el propio cliente guarde el sobre
  // cifrado localmente y lo "abra" ahí cuando llegue la fecha — pendiente,
  // no implementado todavía. (El código viejo de creación se sacó del todo
  // — no tiene sentido mantener una ruta que nunca se puede alcanzar.)
  return res.status(410).json({
    error: 'Cápsulas del Tiempo deshabilitadas: dependían de que el servidor viera el texto plano, algo incompatible con el cifrado E2E real que se activó. Hace falta un rediseño donde el cliente guarde y abra la cápsula localmente.'
  });
});

// Se mantiene SOLO para poder seguir abriendo cápsulas creadas ANTES de
// que esto se deshabilitara (dato real que ya existe en la base) — no para
// nada nuevo, por eso no hay ruta de creación viva más arriba.

timeCapsuleRouter.get('/:chatId/:messageId/open', async (req: AuthRequest, res) => {
  const { chatId, messageId } = req.params;

  const member = await requireMembership(req.userId!, chatId);
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const capsule = await prisma.message.findUnique({ where: { id: messageId } });
  if (!capsule || capsule.isDeleted || capsule.chatId !== chatId || capsule.contentType !== 'TIME_CAPSULE') {
    return res.status(404).json({ error: 'Cápsula no encontrada' });
  }

  const metadata: any = capsule.metadata || {};
  const unlockAt = new Date(metadata.unlockAt);

  // Chequeo real contra el reloj del SERVIDOR — nunca contra algo que
  // mande el cliente, para que no se pueda "adelantar" la apertura.
  if (Date.now() < unlockAt.getTime()) {
    const remainingMs = unlockAt.getTime() - Date.now();
    return res.status(403).json({
      error: 'Todavía no se puede abrir esta cápsula',
      unlockAt: unlockAt.toISOString(),
      remainingSeconds: Math.ceil(remainingMs / 1000)
    });
  }

  const openedBy: string[] = Array.isArray(metadata.openedBy) ? metadata.openedBy : [];
  if (!openedBy.includes(req.userId!)) {
    openedBy.push(req.userId!);
    await prisma.message.update({
      where: { id: messageId },
      data: { metadata: { ...metadata, openedBy } }
    });
  }

  return res.json({
    content: decryptContent(capsule.content),
    unlockAt: unlockAt.toISOString(),
    openedBy
  });
});
