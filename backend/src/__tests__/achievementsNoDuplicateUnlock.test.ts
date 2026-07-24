export {}; // scope de módulo propio

const mockStreakFindUnique = jest.fn();
const mockStreakCreate = jest.fn();
const mockStreakUpdate = jest.fn();
const mockMessageCount = jest.fn();
const mockAchievementFindUnique = jest.fn();
const mockAchievementCreate = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    userStreak: {
      findUnique: (...args: any[]) => mockStreakFindUnique(...args),
      create: (...args: any[]) => mockStreakCreate(...args),
      update: (...args: any[]) => mockStreakUpdate(...args)
    },
    message: { count: (...args: any[]) => mockMessageCount(...args) },
    achievement: {
      findUnique: (...args: any[]) => mockAchievementFindUnique(...args),
      create: (...args: any[]) => mockAchievementCreate(...args)
    }
  }
}));

import { registerActivity } from '../modules/social/achievements';

describe('Logros — solo se reportan desbloqueos genuinamente nuevos (bug real corregido)', () => {
  beforeEach(() => {
    mockStreakFindUnique.mockReset();
    mockStreakCreate.mockReset();
    mockStreakUpdate.mockReset();
    mockMessageCount.mockReset();
    mockAchievementFindUnique.mockReset();
    mockAchievementCreate.mockReset();
  });

  it('reporta un logro como desbloqueado la primera vez que se cumple la condición', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    mockStreakFindUnique.mockResolvedValue({ userId: 'u1', currentStreak: 3, longestStreak: 3, lastActiveDay: today });
    mockMessageCount.mockResolvedValue(5);
    mockAchievementFindUnique.mockResolvedValue(null); // no lo tenía todavía
    mockAchievementCreate.mockResolvedValue({});

    const result = await registerActivity('u1');

    expect(result.unlocked).toContain('STREAK_3');
  });

  it('NO vuelve a reportar un logro que ya estaba desbloqueado (antes se repetía en cada mensaje)', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    mockStreakFindUnique.mockResolvedValue({ userId: 'u1', currentStreak: 30, longestStreak: 30, lastActiveDay: today });
    mockMessageCount.mockResolvedValue(500);
    // Ya tiene los 5 logros — todos existen de antes.
    mockAchievementFindUnique.mockResolvedValue({ userId: 'u1', code: 'STREAK_3' });

    const result = await registerActivity('u1');

    expect(result.unlocked).toEqual([]);
    expect(mockAchievementCreate).not.toHaveBeenCalled();
  });
});
