import { analyzeAccountRisk } from '../modules/moderation/accountRisk';

describe('Sistema Detector de Cuentas Falsas/Spam — heurísticas reales', () => {
  it('no marca riesgo a una cuenta normal y activa hace tiempo', () => {
    const report = analyzeAccountRisk({
      userId: 'u1', accountAgeHours: 24 * 90, messagesSentTotal: 200,
      distinctChatsMessagedLastHour: 2, hasAvatar: true, hasBio: true,
      isVerified: false, reportsAgainstUser: 0
    });
    expect(report.riskScore).toBe(0);
    expect(report.flags).toHaveLength(0);
  });

  it('las cuentas verificadas siempre dan riesgo 0, sin importar otras señales', () => {
    const report = analyzeAccountRisk({
      userId: 'u1', accountAgeHours: 0.5, messagesSentTotal: 10000,
      distinctChatsMessagedLastHour: 500, hasAvatar: false, hasBio: false,
      isVerified: true, reportsAgainstUser: 20
    });
    expect(report.riskScore).toBe(0);
    expect(report.flags).toContain('Cuenta verificada');
  });

  it('detecta el patrón clásico de bot de spam (cuenta nueva + muchos chats en 1 hora)', () => {
    const report = analyzeAccountRisk({
      userId: 'u1', accountAgeHours: 0.3, messagesSentTotal: 15,
      distinctChatsMessagedLastHour: 12, hasAvatar: false, hasBio: false,
      isVerified: false, reportsAgainstUser: 0
    });
    expect(report.riskScore).toBeGreaterThan(0);
    expect(report.flags.some((f) => f.includes('menos de 1 hora'))).toBe(true);
  });

  it('detecta perfil vacío con alto volumen de mensajes', () => {
    const report = analyzeAccountRisk({
      userId: 'u1', accountAgeHours: 500, messagesSentTotal: 100,
      distinctChatsMessagedLastHour: 1, hasAvatar: false, hasBio: false,
      isVerified: false, reportsAgainstUser: 0
    });
    expect(report.flags.some((f) => f.includes('Perfil sin completar'))).toBe(true);
  });

  it('los reportes de otros usuarios son la señal con más peso', () => {
    const withReports = analyzeAccountRisk({
      userId: 'u1', accountAgeHours: 500, messagesSentTotal: 50,
      distinctChatsMessagedLastHour: 1, hasAvatar: true, hasBio: true,
      isVerified: false, reportsAgainstUser: 5
    });
    expect(withReports.riskScore).toBeGreaterThanOrEqual(50);
  });

  it('el puntaje nunca supera 100 aunque se acumulen todas las señales', () => {
    const report = analyzeAccountRisk({
      userId: 'u1', accountAgeHours: 0.1, messagesSentTotal: 5000,
      distinctChatsMessagedLastHour: 100, hasAvatar: false, hasBio: false,
      isVerified: false, reportsAgainstUser: 50
    });
    expect(report.riskScore).toBeLessThanOrEqual(100);
  });
});
