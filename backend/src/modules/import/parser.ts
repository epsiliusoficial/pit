// Sistema "Importar Chat de WhatsApp" — lógica pura de parseo, sin dependencias
// de base de datos. Separado a propósito para poder testearlo de forma aislada.
export interface ParsedLine {
  timestamp: Date;
  sender: string;
  content: string;
}

export function parseWhatsAppExport(text: string): ParsedLine[] {
  // Formato típico: "12/5/24, 14:30 - Juan Pérez: Hola, ¿cómo estás?"
  // También soporta el formato con corchetes de iOS: "[12/5/24, 14:30:05] Juan: Hola"
  const linePattern = /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*-?\s*([^:]+):\s*(.*)$/;
  const lines = text.split('\n');
  const results: ParsedLine[] = [];
  let current: ParsedLine | null = null;

  for (const rawLine of lines) {
    const match = rawLine.match(linePattern);
    if (match) {
      if (current) results.push(current);
      const [, datePart, timePart, sender, content] = match;
      const timestamp = parseWhatsAppDate(datePart, timePart);
      current = { timestamp, sender: sender.trim(), content: content.trim() };
    } else if (current && rawLine.trim()) {
      current.content += '\n' + rawLine.trim();
    }
  }
  if (current) results.push(current);
  return results;
}

function parseWhatsAppDate(datePart: string, timePart: string): Date {
  const [d, m, y] = datePart.split('/').map(Number);
  const year = y < 100 ? 2000 + y : y;
  const [h, min, s] = timePart.split(':').map(Number);
  return new Date(year, m - 1, d, h, min, s || 0);
}
