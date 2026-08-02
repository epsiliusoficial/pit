// Sistema "PIN de Emergencia / Modo Pánico" (nuevo): pensado para cuando te
// OBLIGAN a desbloquear tu chat (pareja controladora, robo, control
// fronterizo, lo que sea) — configurás una segunda contraseña que, si la
// usás para entrar, te deja entrar de verdad (mismo token, mismo flujo),
// pero deja tu bandeja archivada por completo, como si no tuvieras chats.
// Quien te está mirando la pantalla no ve ninguna señal de que pasó algo
// raro — el login "funciona" igual, solo que no hay nada para ver.
//
// Diseño, sin inventar tablas nuevas:
// - El PIN de pánico se guarda hasheado (misma función hashPassword que ya
//   usa la contraseña real) en User.settings.panicPinHash — nunca en texto
//   plano, nunca en el mismo campo que la contraseña real.
// - Activarlo (POST /api/auth/panic-pin) requiere estar autenticado con tu
//   contraseña real primero — no se puede configurar a la fuerza en el
//   momento de un secuestro de sesión.
// - El chequeo real en el login (login normal, ver auth/controller.ts)
//   pasa SOLO si la contraseña real no matcheó — nunca reemplaza ni debilita
//   la verificación normal, es un fallback adicional.
// - Archivar (no borrar) es a propósito: es reversible por vos mismo desde
//   un login real más tarde, y no destruye nada de los demás miembros de
//   los chats — el "pánico" es tuyo, no un ataque a la conversación.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { hashPassword, comparePassword } from '../../core/crypto/hash';
import { AuthRequest, authMiddleware } from './middleware';

export const panicPinRouter = Router();
panicPinRouter.use(authMiddleware);

const MIN_PIN_LENGTH = 4;

panicPinRouter.post('/', async (req: AuthRequest, res) => {
  const { currentPassword, panicPin } = req.body;
  if (!currentPassword) return res.status(400).json({ error: 'currentPassword requerida' });
  if (!panicPin || typeof panicPin !== 'string' || panicPin.length < MIN_PIN_LENGTH) {
    return res.status(400).json({ error: `panicPin debe tener al menos ${MIN_PIN_LENGTH} caracteres` });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const validPassword = await comparePassword(currentPassword, user.passwordHash);
  if (!validPassword) return res.status(401).json({ error: 'Contraseña incorrecta' });

  // El PIN de pánico NUNCA puede ser igual a la contraseña real — si lo
  // fuera, la contraseña real siempre "ganaría" el chequeo y el modo
  // pánico jamás se activaría (comparePassword contra el hash real ya
  // habría dado true antes de llegar a chequear el pánico).
  if (await comparePassword(panicPin, user.passwordHash)) {
    return res.status(400).json({ error: 'El PIN de pánico no puede ser igual a tu contraseña real' });
  }

  const panicPinHash = await hashPassword(panicPin);
  const settings = (user.settings as any) || {};
  settings.panicPinHash = panicPinHash;

  await prisma.user.update({ where: { id: req.userId! }, data: { settings } });
  return res.json({ configured: true });
});

panicPinRouter.delete('/', async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const settings = (user.settings as any) || {};
  delete settings.panicPinHash;

  await prisma.user.update({ where: { id: req.userId! }, data: { settings } });
  return res.json({ configured: false });
});
