// Sistema "Markdown en mensajes": convierte *negrita*, _cursiva_, ~tachado~ y
// `código` a HTML seguro (escapa el resto para evitar XSS). Mismo estilo de
// markdown que usan WhatsApp/Telegram/Slack en sus mensajes de texto.
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMessageMarkdown(rawText: string): string {
  let html = escapeHtml(rawText);

  // Sistema de placeholders: el contenido de `código` se aparta ANTES de aplicar
  // negrita/cursiva/tachado, y se restaura al final. Así "*texto*" dentro de un
  // bloque de código nunca se convierte en <strong>, sin importar el orden de reglas.
  const codeBlocks: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_match, content) => {
    codeBlocks.push(content);
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });

  html = html.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  html = html.replace(/~([^~\n]+)~/g, '<s>$1</s>');
  html = html.replace(/\n/g, '<br>');

  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => `<code>${codeBlocks[Number(index)]}</code>`);

  return html;
}
