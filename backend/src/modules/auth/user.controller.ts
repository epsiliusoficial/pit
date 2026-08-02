// Sistema "Perfil": editar nombre, bio, avatar y ajustes (incluye ghostMode, tema, idioma).
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const userRouter = Router();
userRouter.use(authMiddleware);

const MAX_NAME_LENGTH = 80;
const MAX_BIO_LENGTH = 500;

function isSafeAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

userRouter.get('/me', async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: 'No encontrado' });
  const { passwordHash, privateKeyEnc, ...safe } = user;
  return res.json(safe);
});

userRouter.put('/me', async (req: AuthRequest, res) => {
  const { name, bio, avatarUrl, settings } = req.body;

  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LENGTH)) {
    return res.status(400).json({ error: `name debe ser texto no vacío de hasta ${MAX_NAME_LENGTH} caracteres` });
  }
  if (bio !== undefined && bio !== null && (typeof bio !== 'string' || bio.length > MAX_BIO_LENGTH)) {
    return res.status(400).json({ error: `bio debe ser texto de hasta ${MAX_BIO_LENGTH} caracteres` });
  }
  if (avatarUrl !== undefined && avatarUrl !== null && (typeof avatarUrl !== 'string' || !isSafeAvatarUrl(avatarUrl))) {
    return res.status(400).json({ error: 'avatarUrl debe ser una URL http/https válida' });
  }
  if (settings !== undefined && (typeof settings !== 'object' || settings === null || Array.isArray(settings))) {
    return res.status(400).json({ error: 'settings debe ser un objeto' });
  }

  let mergedSettings: Record<string, any> | undefined;
  if (settings) {
    // Sistema "Merge seguro de settings" (bug de seguridad corregido): antes
    // esta ruta pisaba TODO el JSON de settings con lo que mandara el
    // cliente. Como el 2FA (TOTP) guarda su secret/estado ahí mismo bajo la
    // clave `totp`, un token robado (XSS, cliente malicioso, etc.) podía
    // desactivar el 2FA de un usuario con un simple `PUT /me { settings: {} }`
    // — sin contraseña ni código, saltándose por completo la protección real
    // de /2fa/disable. Ahora se hace merge superficial en vez de reemplazo
    // total, y la clave `totp` queda explícitamente fuera del alcance de
    // esta ruta: solo /api/auth/2fa/* puede tocarla.
    const current = await prisma.user.findUnique({ where: { id: req.userId }, select: { settings: true } });
    const currentSettings = (current?.settings && typeof current.settings === 'object') ? current.settings as Record<string, any> : {};
    const { totp: _ignoredTotp, ...restIncoming } = settings;
    mergedSettings = { ...currentSettings, ...restIncoming, ...(currentSettings.totp ? { totp: currentSettings.totp } : {}) };
  }

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: {
      ...(name !== undefined && { name }),
      ...(bio !== undefined && { bio }),
      ...(avatarUrl !== undefined && { avatarUrl }),
      ...(mergedSettings && { settings: mergedSettings })
    }
  });
  const { passwordHash, privateKeyEnc, ...safe } = user;
  return res.json(safe);
});

// Búsqueda de usuarios por teléfono, para armar chats nuevos
userRouter.get('/search', async (req: AuthRequest, res) => {
  const q = String(req.query.phone || '');
  if (!q) return res.status(400).json({ error: 'phone requerido' });
  const users = await prisma.user.findMany({
    where: { phone: { contains: q } },
    select: { id: true, name: true, phone: true, avatarUrl: true, isOnline: true },
    take: 10
  });
  return res.json(users);
});
