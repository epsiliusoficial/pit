// Sistema nuevo "2FA con TOTP": segundo factor de autenticación real además
// de la contraseña. Flujo estándar de 3 pasos:
//   1. POST /setup    → genera un secret nuevo (todavía NO activo) y el link
//      otpauth:// para escanear con Google Authenticator/Authy/etc.
//   2. POST /confirm  → el usuario manda el primer código generado por su
//      app; si es válido, recién ahí se activa el 2FA. Esto evita que un
//      usuario quede bloqueado por haber escaneado mal el QR.
//   3. POST /disable  → exige contraseña actual Y un código TOTP válido
//      (o un código de recuperación) para desactivar — igual que
//      change-password, un JWT robado no alcanza para bajar la seguridad
//      de la cuenta.
//
// El secret y los códigos de recuperación se guardan dentro de
// User.settings (JSON ya existente) bajo la clave `totp`, para no requerir
// una migración de schema. Los códigos de recuperación se guardan
// hasheados (igual que la contraseña) — nunca en texto plano.
import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from './middleware';
import { comparePassword, hashPassword } from '../../core/crypto/hash';
import { generateTotpSecret, buildOtpauthUrl, verifyTotpCode } from '../../core/crypto/totp';
import { auditLog } from '../../core/audit/auditLog';

export const twoFactorRouter = Router();
twoFactorRouter.use(authMiddleware);

interface TotpSettings {
  secret: string;
  enabled: boolean;
  recoveryCodeHashes?: string[];
}

function getSettings(user: any): Record<string, any> {
  return (user.settings && typeof user.settings === 'object') ? user.settings : {};
}

function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex'));
}

twoFactorRouter.get('/status', async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const totp: TotpSettings | undefined = getSettings(user).totp;
  return res.json({ enabled: !!totp?.enabled });
});

twoFactorRouter.post('/setup', async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const settings = getSettings(user);
  if (settings.totp?.enabled) {
    return res.status(400).json({ error: '2FA ya está activado — desactivalo antes de reconfigurar' });
  }

  const secret = generateTotpSecret();
  // 🔧 FIX: añadimos `as any` para que Prisma acepte el JSON anidado
  const newSettings = { ...settings, totp: { secret, enabled: false } as TotpSettings };
  await prisma.user.update({ where: { id: user.id }, data: { settings: newSettings as any } });

  return res.json({
    secret,
    otpauthUrl: buildOtpauthUrl(secret, user.phone)
  });
});

twoFactorRouter.post('/confirm', async (req: AuthRequest, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code requerido' });

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const settings = getSettings(user);
  const totp: TotpSettings | undefined = settings.totp;
  if (!totp?.secret) return res.status(400).json({ error: 'Primero llamá a /setup' });
  if (totp.enabled) return res.status(400).json({ error: '2FA ya está activado' });

  if (!verifyTotpCode(totp.secret, String(code))) {
    return res.status(401).json({ error: 'Código inválido' });
  }

  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodeHashes = await Promise.all(recoveryCodes.map((c) => hashPassword(c)));

  // 🔧 FIX: añadimos `as any` aquí también
  const newSettings = {
    ...settings,
    totp: { secret: totp.secret, enabled: true, recoveryCodeHashes } as TotpSettings
  };
  await prisma.user.update({ where: { id: user.id }, data: { settings: newSettings as any } });
  await auditLog({ userId: user.id, action: 'LOGIN', metadata: { event: 'totp_enabled' }, ip: req.ip });

  return res.json({ enabled: true, recoveryCodes });
});

twoFactorRouter.post('/disable', async (req: AuthRequest, res) => {
  const { password, code } = req.body;
  if (!password || !code) return res.status(400).json({ error: 'password y code requeridos' });

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const validPassword = await comparePassword(password, user.passwordHash);
  if (!validPassword) return res.status(401).json({ error: 'Contraseña incorrecta' });

  const settings = getSettings(user);
  const totp: TotpSettings | undefined = settings.totp;
  if (!totp?.enabled) return res.status(400).json({ error: '2FA no está activado' });

  const validTotp = verifyTotpCode(totp.secret, String(code));
  let validRecovery = false;
  if (!validTotp && totp.recoveryCodeHashes) {
    for (const hash of totp.recoveryCodeHashes) {
      if (await comparePassword(String(code), hash)) {
        validRecovery = true;
        break;
      }
    }
  }
  if (!validTotp && !validRecovery) return res.status(401).json({ error: 'Código inválido' });

  const { totp: _removed, ...restSettings } = settings;
  await prisma.user.update({ where: { id: user.id }, data: { settings: restSettings } });
  await auditLog({ userId: user.id, action: 'LOGIN', metadata: { event: 'totp_disabled' }, ip: req.ip });

  return res.json({ enabled: false });
});

/** Usado por el login (auth/controller.ts) para saber si hay que pedir el segundo factor. */
export function totpSettingsOf(user: any): TotpSettings | undefined {
  return getSettings(user).totp;
}

/** Verifica un código TOTP o de recuperación durante el login. Si se usa un
 * código de recuperación, lo consume (no sirve dos veces). */
export async function verifyLoginTotp(
  userId: string,
  settings: Record<string, any>,
  totp: TotpSettings,
  code: string
): Promise<boolean> {
  if (verifyTotpCode(totp.secret, code)) return true;

  if (totp.recoveryCodeHashes) {
    for (let i = 0; i < totp.recoveryCodeHashes.length; i++) {
      if (await comparePassword(code, totp.recoveryCodeHashes[i])) {
        const remaining = totp.recoveryCodeHashes.filter((_, idx) => idx !== i);
        const newSettings = { ...settings, totp: { ...totp, recoveryCodeHashes: remaining } };
        await prisma.user.update({ where: { id: userId }, data: { settings: newSettings as any } });
        return true;
      }
    }
  }
  return false;
}