import { parseWhatsAppExport } from '../modules/import/parser';

describe('Sistema de Importación de WhatsApp — parser real', () => {
  it('parsea una exportación típica de Android', () => {
    const text = [
      '12/5/24, 14:30 - Juan Pérez: Hola, ¿cómo estás?',
      '12/5/24, 14:31 - María: Todo bien, ¿y vos?'
    ].join('\n');

    const result = parseWhatsAppExport(text);
    expect(result).toHaveLength(2);
    expect(result[0].sender).toBe('Juan Pérez');
    expect(result[0].content).toBe('Hola, ¿cómo estás?');
    expect(result[1].sender).toBe('María');
  });

  it('parsea el formato con corchetes de iOS', () => {
    const text = '[12/5/24, 14:30:05] Juan: Hola desde iPhone';
    const result = parseWhatsAppExport(text);
    expect(result).toHaveLength(1);
    expect(result[0].sender).toBe('Juan');
    expect(result[0].content).toBe('Hola desde iPhone');
  });

  it('une líneas de continuación a un mensaje multilínea', () => {
    const text = [
      '12/5/24, 14:30 - Juan: Primera línea',
      'Segunda línea sin remitente',
      'Tercera línea también'
    ].join('\n');

    const result = parseWhatsAppExport(text);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Primera línea\nSegunda línea sin remitente\nTercera línea también');
  });

  it('devuelve un array vacío si el formato no se reconoce', () => {
    const result = parseWhatsAppExport('esto no es una exportación de WhatsApp');
    expect(result).toHaveLength(0);
  });

  it('interpreta correctamente la fecha y hora', () => {
    const text = '5/3/24, 09:15 - Ana: Buen día';
    const result = parseWhatsAppExport(text);
    expect(result[0].timestamp.getFullYear()).toBe(2024);
    expect(result[0].timestamp.getMonth()).toBe(2); // marzo = índice 2
    expect(result[0].timestamp.getDate()).toBe(5);
    expect(result[0].timestamp.getHours()).toBe(9);
    expect(result[0].timestamp.getMinutes()).toBe(15);
  });
});
