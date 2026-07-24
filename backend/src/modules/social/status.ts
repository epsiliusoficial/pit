// Sistema "Estados / Historias": contenido visible solo 24hs, con marca real
// de quién lo vio. El worker de barrido (statusSweeper.ts) borra los vencidos.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { encryptContent, decryptContent } from '../../core/crypto/messageEncryption';

export const statusRouter = Router();
statusRouter.use(authMiddleware);

statusRouter.post('/create', async (req: AuthRequest, res) => {
  const { content, mediaUrl } = req.body;
  if (!content && !mediaUrl) return res.status(400).json({ error: 'content o mediaUrl requerido' });

  // Mismo sistema de cifrado en reposo que los mensajes — consistencia real,
  // no solo los chats privados merecen esta protección.
  const status = await prisma.status.create({
    data: {
      userId: req.userId!,
      content: encryptContent(content || ''),
      mediaUrl,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  });
  return res.json({ ...status, content: content || '' });
});

// Feed real: estados de mis contactos que todavía no vencieron.
//
// Bug de privacidad corregido: el feed no descartaba a usuarios que se
// bloquearon mutuamente. Si A tenía a B en contactos pero B bloqueó a A (o
// A bloqueó a B) después, los estados de B le seguían apareciendo a A en el
// feed — el bloqueo cortaba mensajes nuevos (ver chat/controller.ts) pero
// nunca se aplicó acá. Ahora se excluyen ambas direcciones del bloqueo.
statusRouter.get('/feed', async (req: AuthRequest, res) => {
  const contacts = await prisma.contact.findMany({ where: { ownerId: req.userId! } });
  const contactIds = contacts.map((c: any) => c.contactId);

  const [blockedByMe, blockedMe] = await Promise.all([
    prisma.block.findMany({ where: { blockerId: req.userId! }, select: { blockedId: true } }),
    prisma.block.findMany({ where: { blockedId: req.userId! }, select: { blockerId: true } })
  ]);
  const excluded = new Set<string>([
    ...blockedByMe.map((b: any) => b.blockedId),
    ...blockedMe.map((b: any) => b.blockerId)
  ]);
  const visibleUserIds = [...contactIds, req.userId!].filter((id) => !excluded.has(id));

  const statuses = await prisma.status.findMany({
    where: { userId: { in: visibleUserIds }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });
  return res.json(statuses.map((s: any) => ({ ...s, content: decryptContent(s.content) })));
});

// Bug de autorización corregido: cualquier usuario autenticado que conociera
// (o adivinara) el id de un estado podía marcarlo como visto, sin importar
// si era contacto del dueño o si alguna de las dos partes había bloqueado a
// la otra — filtrando así, por ejemplo, que efectivamente vio un estado
// pensado para un círculo cerrado. Ahora se exige la misma regla de
// visibilidad que ya aplica en /feed: ser el propio dueño, o un contacto sin
// bloqueo mutuo.
statusRouter.post('/:id/view', async (req: AuthRequest, res) => {
  const status = await prisma.status.findUnique({ where: { id: req.params.id } });
  if (!status) return res.status(404).json({ error: 'No encontrado' });

  if (status.expiresAt < new Date()) {
    return res.status(410).json({ error: 'Este estado ya expiró' });
  }

  if (status.userId !== req.userId!) {
    const [isContact, blocked] = await Promise.all([
      prisma.contact.findUnique({ where: { ownerId_contactId: { ownerId: req.userId!, contactId: status.userId } } }),
      prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: req.userId!, blockedId: status.userId },
            { blockerId: status.userId, blockedId: req.userId! }
          ]
        }
      })
    ]);
    if (!isContact || blocked) {
      return res.status(403).json({ error: 'No podés ver este estado' });
    }
  }

  const viewedBy: string[] = Array.isArray(status.viewedBy) ? (status.viewedBy as string[]) : [];
  if (!viewedBy.includes(req.userId!)) viewedBy.push(req.userId!);

  await prisma.status.update({ where: { id: req.params.id }, data: { viewedBy } });
  return res.json({ viewedBy });
});
