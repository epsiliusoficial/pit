// Sistema "Reputación Comunitaria de Enlaces" (nuevo): el detector de
// phishing que ya existía (safetyCheck.ts) es 100% heurística — patrones
// conocidos de ataques. Esto le suma la otra mitad real: si varios usuarios
// distintos reportan el MISMO dominio como estafa, ese dominio queda
// marcado para todos, aunque no matchee ninguna heurística todavía (un
// dominio de estafa nuevo, hecho a medida, sin patrones reconocibles).
//
// Reusa la tabla Report que ya existía (moderation) — reportedId no tiene
// FK a User, es un string libre, así que un dominio ahí (`link:dominio.com`)
// convive sin romper nada ni pedir una migración nueva. Un mismo usuario no
// puede inflar el conteo reportando el mismo dominio dos veces.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { analyzeLinkSafety } from './safetyCheck';

export const linkReportsRouter = Router();
linkReportsRouter.use(authMiddleware);

const COMMUNITY_FLAG_THRESHOLD = 3;

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

linkReportsRouter.post('/report', async (req: AuthRequest, res) => {
  const { url, reason } = req.body;
  const domain = url ? extractDomain(url) : null;
  if (!domain) return res.status(400).json({ error: 'url inválida' });

  const reportedId = `link:${domain}`;
  const existing = await prisma.report.findFirst({
    where: { reporterId: req.userId!, reportedId, status: { not: 'DISMISSED' } }
  });
  if (existing) return res.status(400).json({ error: 'Ya reportaste este dominio' });

  await prisma.report.create({
    data: { reporterId: req.userId!, reportedId, reason: reason || 'Enlace sospechoso reportado por un usuario' }
  });

  const reportCount = await prisma.report.count({ where: { reportedId, status: { not: 'DISMISSED' } } });
  return res.status(201).json({ domain, reportCount, communityFlagged: reportCount >= COMMUNITY_FLAG_THRESHOLD });
});

// Chequeo combinado: heurística real + reputación comunitaria real, en un
// solo lugar — lo que el cliente debería llamar antes de mostrar un link.
linkReportsRouter.get('/check', async (req: AuthRequest, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: 'url requerida' });

  const heuristic = analyzeLinkSafety(url);
  const domain = extractDomain(url);
  let reportCount = 0;
  if (domain) {
    reportCount = await prisma.report.count({ where: { reportedId: `link:${domain}`, status: { not: 'DISMISSED' } } });
  }
  const communityFlagged = reportCount >= COMMUNITY_FLAG_THRESHOLD;

  return res.json({
    ...heuristic,
    reportCount,
    communityFlagged,
    isSuspicious: heuristic.isSuspicious || communityFlagged
  });
});
