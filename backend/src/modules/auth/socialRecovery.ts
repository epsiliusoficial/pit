// Sistema "Recuperación Social" (nuevo, mismo concepto que la recuperación
// social de las billeteras cripto): elegís un grupo de contactos de
// confianza (guardianes) y un umbral (ej: 2 de 3) — si perdés tu
// contraseña y tu dispositivo, en vez de quedar afuera para siempre,
// pedís una recuperación, tus guardianes la aprueban desde SU cuenta, y al
// juntar el umbral necesario podés poner una contraseña nueva. Nadie puede
// resetear tu cuenta solo — hace falta el consenso real de la gente que vos
// elegiste de antemano.
//
// Diseño, sin migraciones nuevas: todo vive en User.settings.socialRecovery
// = { guardianUserIds, threshold, pendingRequest }. `pendingRequest` guarda
// { id, approvals: string[], createdAt } mientras está en curso.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../../core/database/client';
import { hashPassword } from '../../core/crypto/hash';
import { AuthRequest, authMiddleware } from './middleware';
import { verifyOtp } from './otp.service';
import { getJwtSecret } from '../../core/utils/jwtSecret';
import { encryptContent } from '../../core/crypto/messageEncryption';
import { io } from '../../index';

export const socialRecoveryRouter = Router();

const MIN_GUARDIANS = 2;
const MAX_GUARDIANS = 10;
const RESET_TOKEN_TYPE = 'social-recovery-reset';

// --- Configuración (requiere estar logueado) ---
socialRecoveryRouter.post('/setup', authMiddleware, async (req: AuthRequest, res) => {
  const { guardianUserIds, threshold } = req.body;

  if (!Array.isArray(guardianUserIds) || guardianUserIds.length < MIN_GUARDIANS || guardianUserIds.length > MAX_GUARDIANS) {
    return res.status(400).json({ error: `Necesitás entre ${MIN_GUARDIANS} y ${MAX_GUARDIANS} guardianes` });
  }
  if (guardianUserIds.includes(req.userId)) {
    return res.status(400).json({ error: 'No podés ser tu propio guardián' });
  }
  if (new Set(guardianUserIds).size !== guardianUserIds.length) {
    return res.status(400).json({ error: 'Los guardianes no pueden repetirse' });
  }
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > guardianUserIds.length) {
    return res.status(400).json({ error: `threshold debe ser un entero entre 1 y ${guardianUserIds.length}` });
  }

  const guardians = await prisma.user.findMany({ where: { id: { in: guardianUserIds } } });
  if (guardians.length !== guardianUserIds.length) {
    return res.status(404).json({ error: 'Uno o más guardianes no existen' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { settings: true } });
  const settings = (user?.settings as any) || {};
  settings.socialRecovery = { guardianUserIds, threshold, pendingRequest: null };

  await prisma.user.update({ where: { id: req.userId! }, data: { settings } });
  return res.json({ guardianUserIds, threshold });
});

// --- Iniciar una recuperación (sin sesión, pero con el teléfono + OTP real) ---
socialRecoveryRouter.post('/request', async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'phone y otp requeridos' });

  const validOtp = await verifyOtp(phone, otp);
  if (!validOtp) return res.status(401).json({ error: 'OTP inválido o expirado' });

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const config = (user.settings as any)?.socialRecovery;
  if (!config?.guardianUserIds?.length) {
    return res.status(400).json({ error: 'Esta cuenta no configuró Recuperación Social' });
  }

  const requestId = crypto.randomBytes(8).toString('hex');
  const settings = { ...(user.settings as any), socialRecovery: { ...config, pendingRequest: { id: requestId, approvals: [], createdAt: new Date().toISOString() } } };
  await prisma.user.update({ where: { id: user.id }, data: { settings } });

  // Aviso real a cada guardián — mensaje directo, no un canal aparte.
  for (const guardianId of config.guardianUserIds) {
    let chat = await prisma.chat.findFirst({
      where: { isGroup: false, AND: [{ users: { some: { userId: user.id } } }, { users: { some: { userId: guardianId } } }] }
    });
    if (!chat) {
      chat = await prisma.chat.create({ data: { isGroup: false, users: { create: [{ userId: user.id }, { userId: guardianId }] } } });
    }
    const alertText = `🔑 ${user.name} pidió recuperar su cuenta. Si sos vos quien confía en esto, aprobalo desde Recuperación Social.`;
    const message = await prisma.message.create({
      data: { chatId: chat.id, senderId: user.id, content: encryptContent(alertText), contentType: 'SYSTEM' }
    });
    io.to(chat.id).emit('new_message', { ...message, content: alertText });
  }

  return res.json({ requestId, guardiansNotified: config.guardianUserIds.length, threshold: config.threshold });
});

// --- Un guardián aprueba (requiere estar logueado como ese guardián) ---
socialRecoveryRouter.post('/approve', authMiddleware, async (req: AuthRequest, res) => {
  const { phone, requestId } = req.body;
  if (!phone || !requestId) return res.status(400).json({ error: 'phone y requestId requeridos' });

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const config = (user.settings as any)?.socialRecovery;
  const pending = config?.pendingRequest;
  if (!pending || pending.id !== requestId) {
    return res.status(400).json({ error: 'No hay una recuperación pendiente con ese id' });
  }
  if (!config.guardianUserIds.includes(req.userId)) {
    return res.status(403).json({ error: 'No sos guardián de esta cuenta' });
  }

  const approvals: string[] = pending.approvals.includes(req.userId!)
    ? pending.approvals
    : [...pending.approvals, req.userId!];

  const settings = { ...(user.settings as any), socialRecovery: { ...config, pendingRequest: { ...pending, approvals } } };
  await prisma.user.update({ where: { id: user.id }, data: { settings } });

  return res.json({ approvals: approvals.length, threshold: config.threshold, reached: approvals.length >= config.threshold });
});

// --- Consultar estado y obtener el token de reseteo si ya se llegó al umbral ---
socialRecoveryRouter.post('/status', async (req, res) => {
  const { phone, requestId } = req.body;
  if (!phone || !requestId) return res.status(400).json({ error: 'phone y requestId requeridos' });

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const config = (user.settings as any)?.socialRecovery;
  const pending = config?.pendingRequest;
  if (!pending || pending.id !== requestId) {
    return res.status(400).json({ error: 'No hay una recuperación pendiente con ese id' });
  }

  const approved = pending.approvals.length >= config.threshold;
  if (!approved) return res.json({ approved: false, approvals: pending.approvals.length, threshold: config.threshold });

  const resetToken = jwt.sign({ userId: user.id, type: RESET_TOKEN_TYPE, requestId }, getJwtSecret(), { expiresIn: '15m' });
  return res.json({ approved: true, resetToken });
});

// --- Poner la contraseña nueva con el token obtenido en /status ---
socialRecoveryRouter.post('/reset', async (req, res) => {
  const { resetToken, newPassword } = req.body;
  if (!resetToken || !newPassword) return res.status(400).json({ error: 'resetToken y newPassword requeridos' });

  let payload: any;
  try {
    payload = jwt.verify(resetToken, getJwtSecret());
  } catch {
    return res.status(401).json({ error: 'resetToken inválido o vencido' });
  }
  if (payload.type !== RESET_TOKEN_TYPE) return res.status(401).json({ error: 'resetToken inválido' });

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const config = (user.settings as any)?.socialRecovery;
  if (config?.pendingRequest?.id !== payload.requestId) {
    return res.status(400).json({ error: 'Esta recuperación ya no está vigente' });
  }

  const passwordHash = await hashPassword(newPassword);
  const settings = { ...(user.settings as any), socialRecovery: { ...config, pendingRequest: null } };
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, settings } });

  return res.json({ reset: true });
});
