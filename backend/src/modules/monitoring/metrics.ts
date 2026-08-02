// Sistema "Métricas": expone contadores reales en formato texto compatible con
// Prometheus (`/metrics`), el estándar de facto para monitoreo. No son números
// inventados: se consultan contra la base de datos y el estado real del proceso.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { redis } from '../../core/database/redis';

export const metricsRouter = Router();

let requestCount = 0;
export function incrementRequestCount() {
  requestCount++;
}

metricsRouter.get('/metrics', async (_req, res) => {
  const [userCount, messageCount, chatCount, activeConnectionsToday] = await Promise.all([
    prisma.user.count(),
    prisma.message.count(),
    prisma.chat.count(),
    prisma.user.count({ where: { lastSeen: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
  ]);

  const memory = process.memoryUsage();
  const uptimeSeconds = process.uptime();

  const lines = [
    '# HELP pit_users_total Cantidad total de usuarios registrados',
    '# TYPE pit_users_total gauge',
    `pit_users_total ${userCount}`,
    '# HELP pit_messages_total Cantidad total de mensajes enviados',
    '# TYPE pit_messages_total gauge',
    `pit_messages_total ${messageCount}`,
    '# HELP pit_chats_total Cantidad total de chats creados',
    '# TYPE pit_chats_total gauge',
    `pit_chats_total ${chatCount}`,
    '# HELP pit_active_users_24h Usuarios activos en las últimas 24 horas',
    '# TYPE pit_active_users_24h gauge',
    `pit_active_users_24h ${activeConnectionsToday}`,
    '# HELP pit_http_requests_total Requests HTTP procesados desde el arranque',
    '# TYPE pit_http_requests_total counter',
    `pit_http_requests_total ${requestCount}`,
    '# HELP pit_process_uptime_seconds Tiempo que lleva corriendo el proceso',
    '# TYPE pit_process_uptime_seconds counter',
    `pit_process_uptime_seconds ${uptimeSeconds.toFixed(0)}`,
    '# HELP pit_memory_rss_bytes Memoria RSS usada por el proceso',
    '# TYPE pit_memory_rss_bytes gauge',
    `pit_memory_rss_bytes ${memory.rss}`,
    '# HELP pit_cache_is_redis 1 si usa Redis real, 0 si usa memoria RAM',
    '# TYPE pit_cache_is_redis gauge',
    `pit_cache_is_redis ${redis.isReal ? 1 : 0}`
  ];

  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  return res.send(lines.join('\n') + '\n');
});
