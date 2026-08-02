export {}; // scope de módulo

const mockMessageCount = jest.fn();
const mockMessageGroupBy = jest.fn();
const mockUserStreakFindUnique = jest.fn();
const mockAchievementCount = jest.fn();
const mockMessageFindMany = jest.fn();
const mockChatFindUnique = jest.fn();

jest.mock('../core/database/client', () => ({
  prisma: {
    message: {
      count: (...args: any[]) => mockMessageCount(...args),
      groupBy: (...args: any[]) => mockMessageGroupBy(...args),
      findMany: (...args: any[]) => mockMessageFindMany(...args)
    },
    userStreak: { findUnique: (...args: any[]) => mockUserStreakFindUnique(...args) },
    achievement: { count: (...args: any[]) => mockAchievementCount(...args) },
    chat: { findUnique: (...args: any[]) => mockChatFindUnique(...args) }
  }
}));

function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Sistema de "Pit Wrapped" — estadísticas personales (nuevo)', () => {
  beforeEach(() => {
    mockMessageCount.mockReset();
    mockMessageGroupBy.mockReset();
    mockUserStreakFindUnique.mockReset();
    mockAchievementCount.mockReset();
    mockMessageFindMany.mockReset();
    mockChatFindUnique.mockReset();
  });

  it('devuelve ceros/nulls razonables para una cuenta sin actividad', async () => {
    const { wrappedRouter } = await import('../modules/social/wrapped');
    const handler = getHandler(wrappedRouter, '/');
    mockMessageCount.mockResolvedValue(0);
    mockMessageGroupBy.mockResolvedValue([]);
    mockUserStreakFindUnique.mockResolvedValue(null);
    mockAchievementCount.mockResolvedValue(0);
    mockMessageFindMany.mockResolvedValue([]);

    const req: any = { userId: 'user1' };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      totalMessages: 0, topChat: null, currentStreak: 0, longestStreak: 0,
      achievementsUnlocked: 0, mostActiveHour: null
    });
  });

  it('calcula el chat más activo y la hora de mayor actividad real', async () => {
    const { wrappedRouter } = await import('../modules/social/wrapped');
    const handler = getHandler(wrappedRouter, '/');
    mockMessageCount.mockResolvedValue(42);
    mockMessageGroupBy.mockResolvedValue([{ chatId: 'chatA', _count: { chatId: 30 } }]);
    mockChatFindUnique.mockResolvedValue({ id: 'chatA', name: 'Amigos' });
    mockUserStreakFindUnique.mockResolvedValue({ currentStreak: 5, longestStreak: 10 });
    mockAchievementCount.mockResolvedValue(3);

    const mkDate = (hour: number) => { const d = new Date(); d.setHours(hour, 0, 0, 0); return d; };
    mockMessageFindMany.mockResolvedValue([
      { createdAt: mkDate(22) }, { createdAt: mkDate(22) }, { createdAt: mkDate(9) }
    ]);

    const req: any = { userId: 'user1' };
    const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      totalMessages: 42,
      topChat: { chatId: 'chatA', name: 'Amigos', messageCount: 30 },
      currentStreak: 5,
      longestStreak: 10,
      achievementsUnlocked: 3,
      mostActiveHour: 22
    });
  });
});
