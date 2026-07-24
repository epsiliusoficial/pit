import { analyzeLinkSafety } from '../modules/links/safetyCheck';

describe('Sistema Detector de Enlaces Maliciosos — heurísticas reales de phishing', () => {
  it('marca como seguro un link normal y legítimo', () => {
    const report = analyzeLinkSafety('https://www.wikipedia.org/wiki/Argentina');
    expect(report.isSuspicious).toBe(false);
    expect(report.reasons).toHaveLength(0);
  });

  it('detecta un dominio Punycode (ataque de homógrafos)', () => {
    const report = analyzeLinkSafety('https://xn--pple-43d.com/login');
    expect(report.isSuspicious).toBe(true);
    expect(report.reasons.some((r) => r.includes('Punycode'))).toBe(true);
  });

  it('detecta un link que apunta directo a una IP', () => {
    const report = analyzeLinkSafety('http://192.168.1.1/verificar-cuenta');
    expect(report.isSuspicious).toBe(true);
    expect(report.reasons.some((r) => r.includes('dirección IP'))).toBe(true);
  });

  it('detecta una marca conocida usada como subdominio engañoso', () => {
    const report = analyzeLinkSafety('https://paypal.com.verificacion-urgente.xyz/login');
    expect(report.isSuspicious).toBe(true);
    expect(report.reasons.some((r) => r.includes('subdominio'))).toBe(true);
  });

  it('detecta un acortador de links conocido', () => {
    const report = analyzeLinkSafety('https://bit.ly/3xAbCdE');
    expect(report.isSuspicious).toBe(true);
    expect(report.reasons.some((r) => r.includes('acortador'))).toBe(true);
  });

  it('detecta subdominios excesivos', () => {
    const report = analyzeLinkSafety('https://a.b.c.d.e.ejemplo.com/pagina');
    expect(report.isSuspicious).toBe(true);
    expect(report.reasons.some((r) => r.includes('subniveles'))).toBe(true);
  });

  it('maneja URLs malformadas sin lanzar excepción', () => {
    const report = analyzeLinkSafety('esto-no-es-una-url');
    expect(report.isSuspicious).toBe(true);
    expect(report.reasons.some((r) => r.includes('inválida'))).toBe(true);
  });

  it('no marca como sospechoso un dominio legítimo que simplemente contiene una palabra parecida', () => {
    const report = analyzeLinkSafety('https://www.paypal.com/login');
    expect(report.reasons.some((r) => r.includes('subdominio'))).toBe(false);
  });
});
