// Sistema "Exportar Conversación" (nuevo): descargá el historial real de un
// chat como archivo de texto o HTML — para guardar una copia propia fuera
// de Pit, mandarla a un abogado, adjuntarla a una denuncia, o simplemente
// tener un respaldo legible sin depender de la app. Descifra los mensajes
// reales (misma clave maestra que usa todo el proyecto) y arma el archivo
// al vuelo, sin guardar nada nuevo en disco.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';

export const chatExportRouter = Router();
chatExportRouter.use(authMiddleware);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Sistema "E2E real (fase 3)": ANTES esto desciframba cada mensaje con la
// clave del servidor — imposible ahora, el contenido es un sobre E2E. La
// exportación sigue viva: el CLIENTE ya tiene cada mensaje descifrado
// localmente (los mostró en pantalla), arma las líneas ahí, y las manda acá
// solo para que el servidor genere el archivo .txt/.html descargable —
// el servidor sigue sin ver un mensaje suelto de la base de datos.
chatExportRouter.post('/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const format = req.query.format === 'html' ? 'html' : 'txt';
  const { lines } = req.body as { lines?: Array<{ when: string; sender: string; body: string }> };

  if (!Array.isArray(lines)) {
    return res.status(400).json({ error: 'lines requerido — armalas en el cliente con tus mensajes ya descifrados' });
  }
  if (lines.length > 5000) {
    return res.status(400).json({ error: 'demasiadas líneas para exportar de una' });
  }

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat) return res.status(404).json({ error: 'Chat no encontrado' });

  const chatLabel = chat.name || (chat.isGroup ? 'Grupo' : 'Chat directo');
  const safeFileName = `pit-export-${chatId}.${format}`;

  if (format === 'html') {
    const rows = lines.map((l) =>
      `<div class="msg"><span class="meta">[${escapeHtml(l.when)}] ${escapeHtml(l.sender)}:</span> ${escapeHtml(l.body)}</div>`
    ).join('\n');
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">` +
      `<title>Exportación de ${escapeHtml(chatLabel)}</title>` +
      `<style>body{font-family:sans-serif;max-width:700px;margin:2rem auto;padding:0 1rem}` +
      `.msg{margin-bottom:.5rem}.meta{color:#666;font-size:.85em;margin-right:.4em}</style></head>` +
      `<body><h1>${escapeHtml(chatLabel)}</h1><p>Exportado el ${new Date().toLocaleString('es-AR')}</p>` +
      `${rows}</body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
    return res.send(html);
  }

  const txt = [`Exportación de ${chatLabel}`, `Generado el ${new Date().toLocaleString('es-AR')}`, ''].concat(
    lines.map((l) => `[${l.when}] ${l.sender}: ${l.body}`)
  ).join('\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
  return res.send(txt);
});
