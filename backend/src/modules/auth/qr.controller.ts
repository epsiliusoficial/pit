// Sistema "QR Instant Join": inicio de sesión en un dispositivo nuevo escaneando
// un QR desde un dispositivo donde YA estás logueado (igual que WhatsApp Web /
// Telegram Desktop). Es real: usa Redis con TTL, sin trucos ni mocks.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { redis } from '../../core/database/redis';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from './middleware';
import { getJwtSecret } from '../../core/utils/jwtSecret';
import { auditLog } from '../../core/audit/auditLog';

export const qrRouter = Router();

// Dos claves separadas en vez de una sola que cambia de significado:
//   - qr:<code>:status  → "pending" | "claimed", se puede leer las veces que
//     sea sin consumirse (no es secreta, solo dice si ya te aprobaron o no).
//   - qr:<code>:result  → el JWT real, un secreto de un solo uso. Se
//     consume atómicamente con getdel, así que aunque dos requests lleguen
//     al mismo tiempo, solo una se lleva el token.
const statusKey = (code: string) => `qr:${code}:status`;
const resultKey = (code: string) => `qr:${code}:result`;

// Paso 1: el dispositivo NUEVO (sin sesión todavía) pide un código y lo muestra como QR.
// Esto es público a propósito: todavía no hay ninguna sesión que proteger en este paso.
qrRouter.post('/generate', async (_req, res) => {
  const code = crypto.randomBytes(16).toString('hex');
  await redis.set(statusKey(code), 'pending', 'EX', 60);
  return res.json({ code, expiresIn: 60 });
});

// Paso 2: el dispositivo YA AUTENTICADO escanea el QR y confirma la sesión.
//
// Bug crítico corregido (de una sesión anterior): antes este endpoint NO
// requería autenticación y confiaba ciegamente en el "phone" del body —
// cualquiera podía llamar /claim con el número de teléfono de OTRA persona
// y recibir un JWT válido para su cuenta, sin contraseña ni OTP. Era un
// bypass total de login.
//
// La corrección real: ahora `authMiddleware` exige un JWT válido para llegar
// acá — el usuario que "aprueba" el QR tiene que estar YA autenticado en el
// dispositivo que escanea, exactamente como funciona WhatsApp Web (necesitás
// tu teléfono ya logueado para autorizar una sesión nueva). El userId sale
// del token verificado, nunca del body.
qrRouter.post('/claim', authMiddleware, async (req: AuthRequest, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code requerido' });

  const status = await redis.get(statusKey(code));
  if (status !== 'pending') return res.status(400).json({ error: 'Código inválido o expirado' });

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  // Consistencia con el login por OTP: esta sesión nueva (el dispositivo que
  // escaneó y aprobó el QR) también queda registrada como Device real, para
  // que la revocación remota funcione igual sin importar cómo se logueó.
  const device = await prisma.device.create({
    data: { userId: user.id, deviceName: 'Sesión vía QR' }
  });

  const token = jwt.sign({ userId: user.id, deviceId: device.id }, getJwtSecret(), { expiresIn: '7d' });
  await redis.set(statusKey(code), 'claimed', 'EX', 30);
  await redis.set(resultKey(code), JSON.stringify({ token, userId: user.id, name: user.name }), 'EX', 30);
  await auditLog({ userId: user.id, action: 'LOGIN', metadata: { via: 'qr' }, ip: req.ip });
  return res.json({ claimed: true });
});

// Paso 3: el dispositivo NUEVO consulta si ya fue aprobado, y recibe el token.
// Público a propósito: solo devuelve algo si alguien con sesión válida lo aprobó.
//
// Bug real corregido: antes el token se leía con `redis.get` y recién
// DESPUÉS se borraba con `redis.del`, como dos pasos separados. Dos
// requests concurrentes a este endpoint (dos pestañas del dispositivo
// nuevo, o una carrera deliberada) podían leer el token ANTES de que
// cualquiera lo borrara, y ambas terminaban con el mismo JWT — un token
// pensado para entregarse una sola vez, entregado dos veces. Ahora
// `getdel` hace el GET+DEL como una sola operación atómica, y al estar en
// una clave separada del status "pending/claimed", no hace falta ningún
// truco de "reponer el valor" que introduciría su propia ventana de carrera.
qrRouter.get('/status/:code', async (req, res) => {
  const status = await redis.get(statusKey(req.params.code));
  if (status !== 'claimed') return res.json({ ready: false });

  const raw = await redis.getdel(resultKey(req.params.code));
  if (!raw) return res.json({ ready: false }); // ya lo consumió otra request

  const data = JSON.parse(raw);
  return res.json({ ready: true, ...data });
});
