import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';
import { Server } from 'socket.io';
import { logger } from './core/utils/logger';
import { getJwtSecret } from './core/utils/jwtSecret';
import { prisma } from './core/database/client';
import { redis } from './core/database/redis';
import { isMasterKeyConfigured } from './core/crypto/messageEncryption';

// Sistema "Fail Fast en Arranque": si NODE_ENV=production y falta JWT_SECRET,
// el servidor se niega a arrancar ACÁ, antes de aceptar ninguna conexión —
// mejor que arrancar silenciosamente con un secret inseguro y descubrirlo
// después de un incidente de seguridad.
try {
  getJwtSecret();
} catch (err: any) {
  logger.error('Arranque abortado por configuración insegura', err);
  process.exit(1);
}

import { authRouter } from './modules/auth/controller';
import { deviceLinkRouter } from './modules/auth/deviceLink';
import { qrRouter } from './modules/auth/qr.controller';
import { userRouter } from './modules/auth/user.controller';
import { deviceRouter } from './modules/auth/devices';
import { twoFactorRouter } from './modules/auth/twoFactor';
import { chatRouter } from './modules/chat/controller';
import { reactionRouter } from './modules/chat/reactions';
import { moderationRouter } from './modules/chat/moderation';
import { pollRouter } from './modules/chat/polls';
import { eventRouter } from './modules/chat/events';
import { extrasRouter } from './modules/chat/extras';
import { inviteRouter } from './modules/chat/invites';
import { chatListRouter } from './modules/chat/chatList';
import { aiRouter } from './modules/ai/controller';
import { pushRouter, sendPushNotification } from './modules/notifications/push';
import { snoozeRouter, processSnoozedMessages } from './modules/chat/snooze';
import { fileRouter } from './modules/files/controller';
import { adminRouter } from './modules/admin/controller';
import { contactRouter } from './modules/social/contacts';
import { statusRouter } from './modules/social/status';
import { channelRouter } from './modules/chat/channels';
import { broadcastRouter } from './modules/chat/broadcastChannels';
import { walletRouter } from './modules/wallet/controller';
import { achievementRouter } from './modules/social/achievements';
import { focusRouter } from './modules/social/focus';
import { reportRouter } from './modules/moderation/reports';
import { verificationRouter } from './modules/moderation/verification';
import { linkPreviewRouter } from './modules/links/preview';
import { importRouter } from './modules/import/controller';
import { stickerRouter } from './modules/chat/stickers';
import { backupRouter } from './modules/backup/controller';
import { biometricRouter } from './modules/biometric/controller';
import { taskRouter } from './modules/chat/tasks';
import { folderRouter } from './modules/chat/folders';
import { autoReplyRouter } from './modules/chat/autoReply';
import { timeCapsuleRouter } from './modules/chat/timeCapsule';
import { autoTranslateRouter } from './modules/ai/autoTranslate';
import { voiceTranscriptionRouter } from './modules/chat/voiceTranscription';
import { safetyNumberRouter } from './modules/auth/safetyNumber';
import { panicPinRouter } from './modules/auth/panicPin';
import { deadManSwitchRouter, checkDeadManSwitches } from './modules/auth/deadManSwitch';
import { screenshotAlertRouter } from './modules/chat/screenshotAlert';
import { vaultRouter } from './modules/auth/vault';
import { chatExportRouter } from './modules/chat/export';
import { customRolesRouter } from './modules/chat/customRoles';
import { socialRecoveryRouter } from './modules/auth/socialRecovery';
import { joinRequestsRouter } from './modules/chat/joinRequests';
import { sharedNoteRouter } from './modules/chat/sharedNote';
import { remindersRouter } from './modules/auth/reminders';
import { wrappedRouter } from './modules/social/wrapped';
import { announcementsRouter } from './modules/chat/announcements';
import { groupExpirationRouter, archiveExpiredGroups } from './modules/chat/groupExpiration';
import { splitBillRouter } from './modules/wallet/splitBill';
import { sosRouter } from './modules/auth/sos';
import { linkReportsRouter } from './modules/links/communityReports';
import { dailyDigestRouter } from './modules/ai/dailyDigest';
import { metricsRouter } from './modules/monitoring/metrics';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './modules/docs/openapi';
import { gameRouter } from './modules/games/controller';
import { registerSocketHandlers } from './api/ws/handlers';
import { processRetryQueue } from './modules/chat/tornado';
import { sweepExpiredMessages } from './core/queue/ephemeralSweeper';
import { processScheduledMessages } from './core/queue/scheduledWorker';
import { sweepExpiredStatuses } from './core/queue/statusSweeper';
import { purgeTrash } from './core/queue/trashPurger';

const app = express();

// Sistema "CORS para Vercel + Render": si definís FRONTEND_URL (ej: https://pit.vercel.app),
// solo ese origen puede llamar a la API. Si NO la definís, se mantiene el comportamiento
// actual (abierto a todos los orígenes) — así esto nunca rompe lo que ya funcionaba.
const FRONTEND_URL = process.env.FRONTEND_URL;
const corsOptions = FRONTEND_URL
  ? { origin: FRONTEND_URL, credentials: true }
  : {}; // sin restricción, igual que antes

// Sistema "Seguridad HTTP": cabeceras estándar (Helmet) sin afectar CORS existente.
// contentSecurityPolicy desactivado para no romper el web-client servido desde acá
// (usa CDN de socket.io inline); si más adelante querés CSP estricta, se configura aparte.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('web-client')); // sirve el cliente web en la raíz del dominio

// Sistema "Rate Limit Global": protección base contra flood, además del límite
// específico de /api/chat/send (rateLimiter.ts). No reemplaza ese, lo complementa.
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, esperá un momento.' }
}));

const server = http.createServer(app);
export const io = new Server(server, { cors: FRONTEND_URL ? { origin: FRONTEND_URL } : { origin: '*' } });

// Sistema "Escalado Horizontal Real": sin esto, Socket.IO guarda las conexiones
// solo en la memoria de ESTA instancia. Si mañana corrés 2+ instancias detrás de
// un load balancer (lo que necesitás para más usuarios de los que aguanta un
// solo proceso Node), un usuario conectado a la instancia A jamás recibe el
// evento en tiempo real de un usuario conectado a la instancia B — mensajes,
// llamadas y presencia se rompen de forma silenciosa y aleatoria en producción.
// El Redis adapter comparte el "pub/sub" de sockets entre todas las instancias.
// Si no hay REDIS_URL (modo local, sin Redis), queda igual que antes: una sola
// instancia en memoria, sin romper el modo local.
if (process.env.REDIS_URL) {
  import('@socket.io/redis-adapter').then(({ createAdapter }) => {
    const pubClient = new (require('ioredis'))(process.env.REDIS_URL);
    const subClient = pubClient.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.IO: Redis adapter activo — listo para múltiples instancias.');
  }).catch((err) => {
    logger.error('Socket.IO: no se pudo activar el Redis adapter, sigue en modo single-instance', err);
  });
}

// Sistema "Health Check Real": antes devolvía "ok" siempre, sin chequear
// nada — Render usa este endpoint para decidir si reiniciar el servicio, así
// que un health check falso significa que una instancia con la base de datos
// caída sigue reportándose "sana" para siempre, dejando a los usuarios con
// una app rota que la plataforma nunca reinicia. Ahora verifica de verdad:
// una consulta liviana a Postgres y un roundtrip real de la cache.
app.get('/health', async (_req, res) => {
  const checks: Record<string, boolean> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }

  try {
    const testKey = `health:${Date.now()}`;
    await redis.set(testKey, '1', 'EX', 5);
    const value = await redis.get(testKey);
    checks.cache = value === '1';
  } catch {
    checks.cache = false;
  }

  // Bug de observabilidad corregido: antes esto no se chequeaba acá, así que
  // un ENCRYPTION_MASTER_KEY ausente o mal configurado en producción recién
  // se notaba cuando alguien mandaba el primer mensaje real (el healthcheck
  // reportaba "ok" mientras tanto). Ahora se valida sin cifrar contenido real.
  checks.encryption = isMasterKeyConfigured();

  const allHealthy = Object.values(checks).every(Boolean);
  return res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    checks,
    time: new Date().toISOString()
  });
});

app.use('/api/auth', authRouter);
app.use('/api/devicelink', deviceLinkRouter);
app.use('/api/auth/qr', qrRouter);
app.use('/api/auth/2fa', twoFactorRouter);
app.use('/api/user', userRouter);
app.use('/api/devices', deviceRouter);
app.use('/api/chat', chatRouter);
app.use('/api/reaction', reactionRouter);
app.use('/api/moderation', moderationRouter);
app.use('/api/poll', pollRouter);
app.use('/api/events', eventRouter);
app.use('/api/extras', extrasRouter);
app.use('/api/invite', inviteRouter);
app.use('/api/chats', chatListRouter);
app.use('/api/ai', aiRouter);
app.use('/api/push', pushRouter);
app.use('/api/files', fileRouter);
app.use('/api/admin', adminRouter);
app.use('/api/contacts', contactRouter);
app.use('/api/status', statusRouter);
app.use('/api/channels', channelRouter);
app.use('/api/broadcast', broadcastRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/achievements', achievementRouter);
app.use('/api/focus', focusRouter);
app.use('/api/reports', reportRouter);
app.use('/api/verification', verificationRouter);
app.use('/api/link-preview', linkPreviewRouter);
app.use('/api/import', importRouter);
app.use('/api/stickers', stickerRouter);
app.use('/api/backup', backupRouter);
app.use('/api/biometric', biometricRouter);
app.use('/api/tasks', taskRouter);
app.use('/api/chat-folders', folderRouter);
app.use('/api/auto-reply', autoReplyRouter);
app.use('/api/capsule', timeCapsuleRouter);
app.use('/api/auto-translate', autoTranslateRouter);
app.use('/api/voice-transcript', voiceTranscriptionRouter);
app.use('/api/auth/safety-number', safetyNumberRouter);
app.use('/api/auth/panic-pin', panicPinRouter);
app.use('/api/auth/dead-man-switch', deadManSwitchRouter);
app.use('/api/screenshot-alert', screenshotAlertRouter);
app.use('/api/auth/vault', vaultRouter);
app.use('/api/chat/export', chatExportRouter);
app.use('/api/chat/roles', customRolesRouter);
app.use('/api/auth/social-recovery', socialRecoveryRouter);
app.use('/api/chat/join-requests', joinRequestsRouter);
app.use('/api/chat/shared-note', sharedNoteRouter);
app.use('/api/reminders', remindersRouter);
app.use('/api/wrapped', wrappedRouter);
app.use('/api/chat/announcements', announcementsRouter);
app.use('/api/chat/expiration', groupExpirationRouter);
app.use('/api/wallet/split-bill', splitBillRouter);
app.use('/api/sos', sosRouter);
app.use('/api/links', linkReportsRouter);
app.use('/api/ai/daily-digest', dailyDigestRouter);
app.use('/api', metricsRouter); // expone /api/metrics
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.use('/api/game', gameRouter);
app.use('/api/snooze', snoozeRouter);

registerSocketHandlers(io);

// Worker del sistema Tornado: reintenta mensajes encolados cada 3 segundos.
setInterval(() => {
  processRetryQueue().catch((e) => logger.error('Error procesando retry queue', e));
}, 3000);

// Worker del sistema de Mensajes Efímeros: barre vencidos cada 10 segundos.
setInterval(() => {
  sweepExpiredMessages().catch((e) => logger.error('Error en sweep de efímeros', e));
}, 10000);

// Worker del sistema de Mensajes Programados: envía los que ya llegaron a su hora.
setInterval(() => {
  processScheduledMessages().catch((e) => logger.error('Error en scheduled worker', e));
}, 15000);

// Worker del sistema de Estados/Historias: borra los vencidos (24hs) cada 60 segundos.
setInterval(() => {
  sweepExpiredStatuses().catch((e) => logger.error('Error en sweep de estados', e));
}, 60000);

// Worker del sistema de Recordatorios (snooze): cada 20s revisa si algún
// mensaje pospuesto ya llegó a su hora, y lo resurfacea para quien lo pospuso
// — evento en tiempo real a su sala personal + push notification.
setInterval(() => {
  processSnoozedMessages(async (entry) => {
    io.to(`user:${entry.userId}`).emit('message_resurfaced', {
      messageId: entry.messageId,
      chatId: entry.chatId
    });
    await sendPushNotification(entry.userId, 'Recordatorio', 'Tenías un mensaje pospuesto para ahora');
  }).catch((e) => logger.error('Error en worker de recordatorios', e));
}, 20000);

// Worker del sistema de Papelera: purga definitivamente lo que lleva 30+ días, una vez al día.
setInterval(() => {
  purgeTrash().catch((e) => logger.error('Error purgando papelera', e));
}, 24 * 60 * 60 * 1000);

// Worker del Interruptor de Hombre Muerto: revisa una vez al día si algún
// usuario que lo activó lleva más días inactivo de los que configuró, y
// avisa a su contacto de confianza.
setInterval(() => {
  checkDeadManSwitches().catch((e) => logger.error('Error en Interruptor de Hombre Muerto', e));
}, 24 * 60 * 60 * 1000);

// Worker de Grupos con Fecha de Vencimiento: archiva una vez al día los
// grupos cuya fecha de vencimiento ya pasó.
setInterval(() => {
  archiveExpiredGroups().catch((e) => logger.error('Error archivando grupos vencidos', e));
}, 24 * 60 * 60 * 1000);

// Sistema "Manejo de errores centralizado": va DESPUÉS de todas las rutas existentes,
// así no cambia ningún endpoint ni su orden. En producción no expone el stack trace.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Error no manejado en una ruta', err);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(err?.status || 500).json({
    error: isProd ? 'Error interno del servidor' : (err?.message || 'Error interno del servidor')
  });
});

// Sistema "Manejo de promesas no capturadas": evita que un error suelto tumbe el proceso.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection (el proceso sigue corriendo)', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception (el proceso sigue corriendo)', err);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`Pit backend corriendo en el puerto ${PORT}`);
});

// Sistema "Apagado Ordenado" (graceful shutdown): Render (y cualquier
// plataforma con rolling deploys) manda SIGTERM en cada redeploy o reinicio.
// Sin manejarlo, Node mata el proceso de inmediato — las requests en curso
// se cortan a mitad de camino, y las conexiones de Prisma/Socket.io quedan
// sin cerrar limpiamente. Esto asegura: dejar de aceptar conexiones nuevas,
// terminar lo que ya estaba en curso, cerrar DB y sockets, y solo entonces
// salir — con un timeout de seguridad por si algo se cuelga.
let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} recibido — iniciando apagado ordenado...`);

  const forceExitTimer = setTimeout(() => {
    logger.error('Apagado ordenado tardó demasiado, forzando salida', new Error('Shutdown timeout'));
    process.exit(1);
  }, 10000);

  try {
    io.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await prisma.$disconnect();
    logger.info('Apagado ordenado completo. Adiós.');
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    logger.error('Error durante el apagado ordenado', err);
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
