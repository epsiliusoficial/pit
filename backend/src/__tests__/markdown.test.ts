import { renderMessageMarkdown } from '../core/utils/markdown';

describe('Sistema de Markdown en mensajes', () => {
  it('convierte *texto* a negrita', () => {
    expect(renderMessageMarkdown('esto es *importante*')).toBe('esto es <strong>importante</strong>');
  });

  it('convierte _texto_ a cursiva', () => {
    expect(renderMessageMarkdown('_hola_')).toBe('<em>hola</em>');
  });

  it('convierte ~texto~ a tachado', () => {
    expect(renderMessageMarkdown('~error~')).toBe('<s>error</s>');
  });

  it('convierte `código` a code', () => {
    expect(renderMessageMarkdown('usá `npm install`')).toBe('usá <code>npm install</code>');
  });

  it('no procesa markdown dentro de un bloque de código', () => {
    expect(renderMessageMarkdown('`*no debería ser negrita*`')).toBe('<code>*no debería ser negrita*</code>');
  });

  it('escapa HTML para prevenir XSS (caso crítico de seguridad)', () => {
    const malicious = '<script>alert("hackeado")</script>';
    const result = renderMessageMarkdown(malicious);
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapa HTML incluso combinado con markdown', () => {
    const malicious = '*<img src=x onerror=alert(1)>*';
    const result = renderMessageMarkdown(malicious);
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
  });
});
