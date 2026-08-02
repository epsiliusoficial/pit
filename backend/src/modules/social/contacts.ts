// Sistema "Agenda de contactos": guardás gente con tu propio alias, y podés
// listar tus contactos con su estado online real.
//
// Optimización real (antes tenía un bug N+1): con 100 contactos hacía 101
// queries (1 por la lista + 1 por cada usuario). Ahora son 2 queries totales.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const contactRouter = Router();
contactRouter.use(authMiddleware);

contactRouter.post('/add', async (req: AuthRequest, res) => {
  const { contactId, alias } = req.body;
  if (!contactId) return res.status(400).json({ error: 'contactId requerido' });

  const target = await prisma.user.findUnique({ where: { id: contactId } });
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  const contact = await prisma.contact.upsert({
    where: { ownerId_contactId: { ownerId: req.userId!, contactId } },
    update: { alias },
    create: { ownerId: req.userId!, contactId, alias }
  });
  return res.json(contact);
});

contactRouter.get('/', async (req: AuthRequest, res) => {
  const contacts = await prisma.contact.findMany({ where: { ownerId: req.userId! } });
  const contactIds = contacts.map((c: any) => c.contactId);

  const users = contactIds.length
    ? await prisma.user.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, name: true, phone: true, avatarUrl: true, isOnline: true, lastSeen: true, statusText: true }
      })
    : [];
  const usersById = new Map<string, any>(users.map((u: any) => [u.id, u]));

  const withDetails = contacts.map((c: any) => {
    const user = usersById.get(c.contactId) || {};
    return { ...user, alias: c.alias || user?.name };
  });
  return res.json(withDetails);
});

contactRouter.delete('/:contactId', async (req: AuthRequest, res) => {
  await prisma.contact.deleteMany({ where: { ownerId: req.userId!, contactId: req.params.contactId } });
  return res.json({ removed: true });
});
