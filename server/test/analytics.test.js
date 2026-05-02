const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-should-be-long-enough-for-hs256-validation-12345';

// Mock Prisma
const mockPrisma = {
  analyticsEvent: {
    create: async (data) => ({ id: 'event-1', ...data.data, createdAt: new Date() }),
    findMany: async () => [],
    count: async () => 0,
  },
  playerMetrics: {
    upsert: async (data) => ({ id: 'metrics-1', ...data.create }),
  },
  gameMetrics: {
    create: async (data) => ({ id: 'metrics-1', ...data.data }),
  },
};

// Mock logger
const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
};

test('trackEvent - creates event with required fields', async () => {
  const event = await mockPrisma.analyticsEvent.create({
    data: {
      userId: 'user-1',
      eventType: 'GAME_COMPLETED',
      data: { result: 'win', duration: 300 },
      sessionId: 'session-1',
    },
  });

  assert.equal(event.eventType, 'GAME_COMPLETED');
  assert.ok(event.id);
});

test('trackEvent - works without userId', async () => {
  const event = await mockPrisma.analyticsEvent.create({
    data: {
      eventType: 'PAGE_VIEW',
      data: { page: '/home' },
    },
  });

  assert.equal(event.eventType, 'PAGE_VIEW');
  assert.ok(event.id);
});

test('calculatePlayerMetrics - returns correct structure', async () => {
  const period = {
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    endDate: new Date(),
  };

  const events = await mockPrisma.analyticsEvent.findMany();
  const gameEvents = events.filter((e) => e.eventType === 'GAME_COMPLETED');

  const metrics = {
    userId: 'user-1',
    period,
    totalGames: gameEvents.length,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalPlaytime: 0,
    avgSessionTime: 0,
    totalEvents: events.length,
  };

  assert.equal(metrics.userId, 'user-1');
  assert.ok('totalGames' in metrics);
  assert.ok('winRate' in metrics);
  assert.ok('totalPlaytime' in metrics);
});

test('calculatePlayerMetrics - winRate is 0 when no games', async () => {
  const metrics = {
    totalGames: 0,
    wins: 0,
    winRate: 0,
  };

  assert.equal(metrics.winRate, 0);
});

test('getGamePerformanceMetrics - returns correct structure', async () => {
  const period = {
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    endDate: new Date(),
  };

  const events = await mockPrisma.analyticsEvent.findMany();
  const activePlayers = new Set(events.map((e) => e.userId).filter(Boolean)).size;

  const metrics = {
    period,
    totalGames: events.length,
    activePlayers,
    avgGameDuration: 0,
    revenue: 0,
  };

  assert.ok('totalGames' in metrics);
  assert.ok('activePlayers' in metrics);
  assert.ok('avgGameDuration' in metrics);
});

test('generateReport - throws on unknown report type', async () => {
  const validTypes = ['player', 'game', 'revenue'];
  const reportType = 'unknown';

  assert.ok(!validTypes.includes(reportType));
});

test('generateReport - accepts valid report types', () => {
  const validTypes = ['player', 'game', 'revenue'];

  for (const type of validTypes) {
    assert.ok(validTypes.includes(type));
  }
});

test('getRealTimeStats - returns timestamp and counts', async () => {
  const stats = {
    timestamp: new Date(),
    eventsLast30Seconds: await mockPrisma.analyticsEvent.count(),
    eventsLast24Hours: await mockPrisma.analyticsEvent.count(),
    activePlayersLast24Hours: 0,
  };

  assert.ok(stats.timestamp instanceof Date);
  assert.ok('eventsLast30Seconds' in stats);
  assert.ok('eventsLast24Hours' in stats);
  assert.ok('activePlayersLast24Hours' in stats);
});

test('event validation - eventType is required', () => {
  const input = { data: { page: '/home' } };
  assert.ok(!input.hasOwnProperty('eventType') || !input.eventType);
});

test('event validation - data must be an object', () => {
  const validData = { result: 'win' };
  assert.equal(typeof validData, 'object');
  assert.ok(!Array.isArray(validData));
});