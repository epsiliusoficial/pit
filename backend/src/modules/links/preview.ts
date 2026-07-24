// Sistema "Vista previa de links": detecta URLs en el mensaje y trae el
// título/imagen/descripción reales haciendo fetch de las etiquetas Open Graph
// de la página — el mismo mecanismo que usa cualquier app de mensajería seria.
import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { logger } from '../../core/utils/logger';
import { analyzeLinkSafety } from './safetyCheck';
import { safeFetch, SsrfBlockedError } from '../../core/utils/ssrfGuard';

export const linkPreviewRouter = Router();
linkPreviewRouter.use(authMiddleware);

function extractMeta(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractTitleFallback(html: string): string | null {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match ? match[1] : null;
}

linkPreviewRouter.get('/', async (req: AuthRequest, res) => {
  const url = String(req.query.url || '');
  if (!url) return res.status(400).json({ error: 'url requerida' });

  // Validación básica de formato — el chequeo real de SSRF (IPs privadas,
  // rebinding de DNS, redirects hacia adentro) lo hace safeFetch más abajo.
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'URL inválida' });
  }

  // Sistema "Detector de Enlaces Maliciosos": se calcula ANTES de intentar
  // traer la vista previa, para que el cliente pueda decidir mostrar una
  // advertencia incluso si después el fetch falla o tarda.
  const safety = analyzeLinkSafety(url);

  try {
    const response = await safeFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PitLinkPreview/1.0)' }
    });
    // Límite de tamaño: no descargar respuestas gigantes solo para leer <head>.
    const html = (await response.text()).slice(0, 500_000);

    const preview = {
      url,
      title: extractMeta(html, 'og:title') || extractTitleFallback(html) || url,
      description: extractMeta(html, 'og:description') || extractMeta(html, 'description'),
      image: extractMeta(html, 'og:image'),
      siteName: extractMeta(html, 'og:site_name'),
      safety
    };
    return res.json(preview);
  } catch (err: any) {
    if (err instanceof SsrfBlockedError) {
      logger.warn(`Link preview bloqueado por protección SSRF: ${err.message}`);
      return res.status(400).json({ error: 'Ese destino no está permitido', safety });
    }
    logger.warn(`No se pudo generar preview de ${url}: ${err.message}`);
    // Aunque falle la vista previa, el reporte de seguridad sigue siendo útil.
    return res.status(502).json({ error: 'No se pudo obtener la vista previa', safety });
  }
});
