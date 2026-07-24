// Sistema "Copia de Seguridad Completa": exporta TODOS los datos de la cuenta
// (perfil, chats, mensajes propios, contactos, logros) en un solo JSON
// descargable — portabilidad real de datos, no solo un chat suelto.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { decryptContent } from '../../core/crypto/messageEncryption';

export const backupRouter = Router();
backupRouter.use(authMiddleware);

backupRouter.get('/export', async (req: AuthRequest, res) => {
  const userId = req.userId!;

  const [user, memberships, sentMessages, contacts, achievements, streak] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, name: true, bio: true, avatarUrl: true, statusText: true, createdAt: true }
    }),
    prisma.chatUser.findMany({ where: { userId }, include: { chat: true } }),
    prisma.message.findMany({ where: { senderId: userId, isDeleted: false } }),
    prisma.contact.findMany({ where: { ownerId: userId } }),
    prisma.achievement.findMany({ where: { userId } }),
    prisma.userStreak.findUnique({ where: { userId } })
  ]);

  const backup = {
    exportedAt: new Date().toISOString(),
    version: 1,
    profile: user,
    chats: memberships.map((m: any) => ({ chatId: m.chatId, name: m.chat.name, isGroup: m.chat.isGroup, role: m.role })),
    myMessages: sentMessages.map((m: any) => ({ ...m, content: decryptContent(m.content) })),
    contacts,
    achievements,
    streak
  };

  res.setHeader('Content-Disposition', `attachment; filename="pit-backup-${userId}.json"`);
  res.setHeader('Content-Type', 'application/json');
  return res.send(JSON.stringify(backup, null, 2));
});

// Sistema "Restaurar copia de seguridad": reimporta perfil y contactos desde
// un backup exportado con /export (los mensajes son de solo lectura histórica,
// no se reinsertan para no duplicar contenido ya existente en los chats reales).
//
// Bugs corregidos: el body de un backup es JSON que en teoría el usuario
// exportó de acá mismo, pero nada impide que alguien lo edite a mano antes
// de restaurarlo (o suba un JSON armado a mano). Antes no había ningún
// límite: bio/statusText/avatarUrl se guardaban tal cual vinieran (tamaño
// arbitrario, avatarUrl con protocolo `javascript:`/`data:`), y el array de
// contactos no tenía tope — un backup con miles de entradas insertadas a
// mano dispara miles de upserts en un solo request. Se aplican los mismos
// límites que ya rigen en /api/user/me.
const MAX_BIO_LENGTH = 500;
const MAX_CONTACTS_TO_RESTORE = 2000;

function isSafeAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

backupRouter.post('/restore-profile', async (req: AuthRequest, res) => {
  const { backup } = req.body;
  if (!backup?.profile) return res.status(400).json({ error: 'Backup inválido' });

  const { bio, statusText, avatarUrl } = backup.profile;
  if (bio !== undefined && bio !== null && (typeof bio !== 'string' || bio.length > MAX_BIO_LENGTH)) {
    return res.status(400).json({ error: `bio del backup inválida (máximo ${MAX_BIO_LENGTH} caracteres)` });
  }
  if (statusText !== undefined && statusText !== null && (typeof statusText !== 'string' || statusText.length > MAX_BIO_LENGTH)) {
    return res.status(400).json({ error: 'statusText del backup inválido' });
  }
  if (avatarUrl !== undefined && avatarUrl !== null && (typeof avatarUrl !== 'string' || !isSafeAvatarUrl(avatarUrl))) {
    return res.status(400).json({ error: 'avatarUrl del backup debe ser una URL http/https válida' });
  }
  if (backup.contacts !== undefined && !Array.isArray(backup.contacts)) {
    return res.status(400).json({ error: 'contacts del backup debe ser una lista' });
  }
  if (Array.isArray(backup.contacts) && backup.contacts.length > MAX_CONTACTS_TO_RESTORE) {
    return res.status(400).json({ error: `Demasiados contactos en el backup (máximo ${MAX_CONTACTS_TO_RESTORE})` });
  }

  const updated = await prisma.user.update({
    where: { id: req.userId! },
    data: {
      bio: bio ?? undefined,
      statusText: statusText ?? undefined,
      avatarUrl: avatarUrl ?? undefined
    }
  });

  if (Array.isArray(backup.contacts)) {
    for (const c of backup.contacts) {
      if (!c || typeof c.contactId !== 'string') continue;
      await prisma.contact.upsert({
        where: { ownerId_contactId: { ownerId: req.userId!, contactId: c.contactId } },
        update: { alias: typeof c.alias === 'string' ? c.alias.slice(0, 80) : undefined },
        create: { ownerId: req.userId!, contactId: c.contactId, alias: typeof c.alias === 'string' ? c.alias.slice(0, 80) : undefined }
      }).catch(() => null); // si el contacto ya no existe como usuario, se ignora esa línea
    }
  }

  return res.json({ restored: true, profile: { id: updated.id, name: updated.name } });
});
