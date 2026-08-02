// Sistema "Bóveda de Chats" (nuevo): ocultá chats puntuales detrás de un PIN
// separado de tu contraseña real — para una conversación que no querés que
// aparezca en la lista principal si alguien te toma el celular prestado un
// minuto, sin llegar al extremo del Modo Pánico (que es para coerción real).
// Acá el chat simplemente no aparece en /api/chats hasta que entrás con el
// PIN de la bóveda.
//
// Diseño, sin migraciones nuevas:
// - Guardado en User.settings.vault = { pinHash, hiddenChatIds: [] } (Json
//   que ya existía, mismo patrón que Auto-Respuesta/Traducción/Pánico).
// - Esconder un chat NO lo archiva ni lo borra — solo agrega su id a la
//   lista `hiddenChatIds`; el propio listado de chats (GET /api/chats, ya
//   existente en otro módulo) es responsabilidad del cliente filtrar según
//   esta lista una vez que la consulta — este módulo expone la lista y el
//   candado, no reimplementa el listado de chats.
// - El PIN de la bóveda tiene el MISMO cuidado que el PIN de pánico: nunca
//   en texto plano, siempre hasheado con la misma función que la contraseña.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { hashPassword, comparePassword } from '../../core/crypto/hash';
import { AuthRequest, authMiddleware } from './middleware';

export const vaultRouter = Router();
vaultRouter.use(authMiddleware);

const MIN_PIN_LENGTH = 4;

async function getSettings(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
  return (user?.settings as any) || {};
}

vaultRouter.post('/setup', async (req: AuthRequest, res) => {
  const { pin } = req.body;
  if (!pin || typeof pin !== 'string' || pin.length < MIN_PIN_LENGTH) {
    return res.status(400).json({ error: `pin debe tener al menos ${MIN_PIN_LENGTH} caracteres` });
  }

  const settings = await getSettings(req.userId!);
  const pinHash = await hashPassword(pin);
  settings.vault = { pinHash, hiddenChatIds: settings.vault?.hiddenChatIds || [] };

  await prisma.user.update({ where: { id: req.userId! }, data: { settings } });
  return res.json({ configured: true });
});

vaultRouter.post('/hide/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;

  const member = await prisma.chatUser.findUnique({ where: { userId_chatId: { userId: req.userId!, chatId } } });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const settings = await getSettings(req.userId!);
  if (!settings.vault?.pinHash) return res.status(400).json({ error: 'Primero configurá un PIN de bóveda con /setup' });

  const hidden: string[] = settings.vault.hiddenChatIds || [];
  if (!hidden.includes(chatId)) hidden.push(chatId);
  settings.vault.hiddenChatIds = hidden;

  await prisma.user.update({ where: { id: req.userId! }, data: { settings } });
  return res.json({ hiddenChatIds: hidden });
});

vaultRouter.post('/unhide/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const settings = await getSettings(req.userId!);
  const hidden: string[] = settings.vault?.hiddenChatIds || [];
  settings.vault = { ...(settings.vault || {}), hiddenChatIds: hidden.filter((id) => id !== chatId) };

  await prisma.user.update({ where: { id: req.userId! }, data: { settings } });
  return res.json({ hiddenChatIds: settings.vault.hiddenChatIds });
});

// Devuelve la lista de chats ocultos SOLO si el PIN de la bóveda es correcto
// — así el cliente puede armar la vista "bóveda desbloqueada" con esos ids.
vaultRouter.post('/unlock', async (req: AuthRequest, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'pin requerido' });

  const settings = await getSettings(req.userId!);
  if (!settings.vault?.pinHash) return res.status(400).json({ error: 'No configuraste una bóveda todavía' });

  const valid = await comparePassword(pin, settings.vault.pinHash);
  if (!valid) return res.status(401).json({ error: 'PIN incorrecto' });

  return res.json({ hiddenChatIds: settings.vault.hiddenChatIds || [] });
});

// Sin PIN — solo confirma si hay algo escondido, para que el cliente sepa
// si mostrar la entrada a la bóveda en el menú (no expone los ids).
vaultRouter.get('/status', async (req: AuthRequest, res) => {
  const settings = await getSettings(req.userId!);
  return res.json({
    configured: !!settings.vault?.pinHash,
    hiddenCount: (settings.vault?.hiddenChatIds || []).length
  });
});
