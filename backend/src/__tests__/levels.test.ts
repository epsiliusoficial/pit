import { calculateXp, calculateLevelProgress } from '../modules/social/levels';

describe('Sistema de Niveles — XP derivado de actividad real', () => {
  it('calcula 0 XP para un usuario sin ninguna actividad', () => {
    const xp = calculateXp({ messagesSent: 0, longestStreak: 0, achievementsUnlocked: 0 });
    expect(xp).toBe(0);
  });

  it('pesa correctamente cada fuente de XP (mensajes, racha, logros)', () => {
    const xp = calculateXp({ messagesSent: 100, longestStreak: 10, achievementsUnlocked: 2 });
    expect(xp).toBe(350);
  });

  it('la racha vale más por unidad que los mensajes (constancia > volumen)', () => {
    const xpFromStreak = calculateXp({ messagesSent: 0, longestStreak: 10, achievementsUnlocked: 0 });
    const xpFromMessages = calculateXp({ messagesSent: 10, longestStreak: 0, achievementsUnlocked: 0 });
    expect(xpFromStreak).toBeGreaterThan(xpFromMessages);
  });

  it('un usuario con 0 XP está en nivel 1 con 0% de progreso', () => {
    const progress = calculateLevelProgress(0);
    expect(progress.level).toBe(1);
    expect(progress.progressPercent).toBe(0);
  });

  it('el nivel sube correctamente a medida que aumenta el XP', () => {
    const low = calculateLevelProgress(50);
    const high = calculateLevelProgress(5000);
    expect(high.level).toBeGreaterThan(low.level);
  });

  it('el progreso dentro de un nivel siempre está entre 0 y 100', () => {
    for (const xp of [0, 50, 150, 500, 2000, 10000]) {
      const progress = calculateLevelProgress(xp);
      expect(progress.progressPercent).toBeGreaterThanOrEqual(0);
      expect(progress.progressPercent).toBeLessThanOrEqual(100);
    }
  });

  it('xpForNextLevel siempre es mayor que xpForCurrentLevel (la curva es creciente)', () => {
    const progress = calculateLevelProgress(1000);
    expect(progress.xpForNextLevel).toBeGreaterThan(progress.xpForCurrentLevel);
  });
});
