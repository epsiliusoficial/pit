import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../core/database/client';
import { hashPassword, comparePassword } from '../../core/crypto/hash';
import { generateKeyPair } from '../../core/crypto/kyber';
import { generateOtp, storeOtp, verifyOtp } from './otp.service';
import { logger } from '../../core/utils/logger';
import { validateBody, otpRequestSchema, otpVerifySchema, changePasswordSchema } from '../../core/validation/schemas';
import { auditLog } from '../../core/audit/auditLog';
import { getJwtSecret } from '../../core/utils/jwtSecret';
import { AuthRequest, authMiddleware } from './middleware';
import { totpSettingsOf, verifyLoginTotp } from './twoFactor';

export const authRouter = Router();

// Paso 1: solicitar OTP para registro o login
authRouter.post('/otp/request', validateBody(otpRequestSchema), async (req, res) => {
  const { phone } = req.body;
  const otp = generateOtp();
  await storeOtp(phone, otp);
  // En producción esto se envía por un proveedor SMS real (Twilio, etc).
  // Aquí lo devolvemos en la respuesta solo si NODE_ENV=development para poder probar sin gastar SMS.
  logger.info(`OTP generado para ${phone}`);
  return res.json({ sent: true, devOtp: process.env.NODE_ENV === 'development' ? otp : undefined });
});

// Paso 2: verificar OTP y registrar (si no existe) o loguear
authRouter.post('/otp/verify', validateBody(otpVerifySchema), async (req, res) => {
  const { phone, otp, name, password } = req.body;
  if (!phone || !otp || !password) return res.status(400).json({ error: 'phone, otp y password requeridos' });

  const valid = await verifyOtp(phone, otp);
  if (!valid) return res.status(401).json({ error: 'OTP inválido o expirado' });

  let user = await prisma.user.findUnique({ where: { phone } });
  let isNewUser = false;

  if (!user) {
    if (!name) return res.status(400).json({ error: 'name requerido para registro' });
    const { publicKey, privateKey } = generateKeyPair();
    const passwordHash = await hashPassword(password);
    user = await prisma.user.create({
      data: {
        phone,
        name,
        publicKey,
        privateKeyEnc: privateKey, // en producción esto se cifra con una KDF derivada del password del usuario en el cliente
        passwordHash,
        settings: { ghostMode: false, theme: 'dark', lang: 'es' }
      }
    });
    isNewUser = true;
  } else {
    const validPassword = await comparePassword(password, user.passwordHash);
    if (!validPassword) return res.status(401).json({ error: 'Contraseña incorrecta' });

    // Sistema "2FA con TOTP": si el usuario activó el segundo factor, la
    // contraseña sola ya no alcanza para loguearse — hace falta además un
    // código válido de su app de autenticación (o uno de recuperación).
    // Esto se chequea ACÁ, antes de emitir ningún JWT: sin el segundo
    // factor, no hay sesión, sin importar qué tan buena sea la contraseña.
    const totp = totpSettingsOf(user);
    if (totp?.enabled) {
      const { totpCode } = req.body;
      if (!totpCode) return res.status(401).json({ error: 'totpCode requerido', requires2fa: true });
      const settings = (user.settings && typeof user.settings === 'object') ? user.settings as Record<string, any> : {};
      const validTotp = await verifyLoginTotp(user.id, settings, totp, String(totpCode));
      if (!validTotp) return res.status(401).json({ error: 'Código 2FA inválido' });
    }
  }

  await auditLog({
    userId: user.id,
    action: isNewUser ? 'REGISTER' : 'LOGIN',
    ip: req.ip
  });

  // Sistema "Revocación de sesión real" (bug funcional corregido): antes,
  // "Dispositivos vinculados" era cosmético — borrar un Device de la lista
  // no invalidaba ningún JWT existente, que seguía siendo válido hasta
  // expirar solo (7 días). Ahora cada login crea un Device real y el JWT
  // lleva su ID adentro; el middleware de auth verifica que ese Device siga
  // existiendo en cada request. Borrar el Device desde /api/devices/:id
  // ahora sí mata la sesión en el siguiente request, de verdad.
  const device = await prisma.device.create({
    data: {
      userId: user.id,
      deviceName: req.body.deviceName || 'Dispositivo',
      userAgent: req.headers['user-agent']
    }
  });

  const token = jwt.sign({ userId: user.id, deviceId: device.id }, getJwtSecret(), { expiresIn: '7d' });
  const refreshToken = jwt.sign({ userId: user.id, deviceId: device.id, type: 'refresh' }, getJwtSecret(), { expiresIn: '30d' });

  return res.json({
    token,
    refreshToken,
    user: { id: user.id, phone: user.phone, name: user.name, publicKey: user.publicKey }
  });
});

// Sistema "Cambiar contraseña": exige la contraseña actual (nunca confiar en
// que quien tiene un JWT válido es dueño legítimo de la cuenta para esto —
// un JWT robado momentáneamente no debería poder cambiar la contraseña sin
// saber la actual). Al cambiarla, se revocan todas las OTRAS sesiones
// (dispositivos) como medida de seguridad estándar — solo sigue viva la
// sesión desde la que se hizo el cambio.
authRouter.post('/change-password', authMiddleware, validateBody(changePasswordSchema), async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const validCurrent = await comparePassword(currentPassword, user.passwordHash);
  if (!validCurrent) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

  const newPasswordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newPasswordHash } });

  // Revoca todas las demás sesiones (dispositivos) — si alguien más tenía
  // acceso, esto lo corta. La sesión actual sigue viva porque su propio
  // deviceId no se toca acá (ver JWT_SECRET/deviceId en el middleware).
  const currentDeviceId = req.deviceId;
  await prisma.device.deleteMany({
    where: { userId: user.id, ...(currentDeviceId ? { id: { not: currentDeviceId } } : {}) }
  });

  await auditLog({ userId: user.id, action: 'LOGIN', metadata: { event: 'password_changed' }, ip: req.ip });
  return res.json({ changed: true });
});

authRouter.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken requerido' });
  try {
    const payload = jwt.verify(refreshToken, getJwtSecret()) as { userId: string; deviceId?: string; type: string };
    if (payload.type !== 'refresh') throw new Error('invalid type');

    // El refresh también respeta la revocación: si el dispositivo fue borrado,
    // no se emite un token nuevo aunque el refresh token siga siendo válido.
    if (payload.deviceId) {
      const device = await prisma.device.findUnique({ where: { id: payload.deviceId } });
      if (!device) return res.status(401).json({ error: 'Sesión revocada' });
    }

    const token = jwt.sign({ userId: payload.userId, deviceId: payload.deviceId }, getJwtSecret(), { expiresIn: '7d' });
    return res.json({ token });
  } catch {
    return res.status(401).json({ error: 'Refresh token inválido' });
  }
});
