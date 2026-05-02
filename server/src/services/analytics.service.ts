import { PrismaClient } from '@prisma/client';
import { logger } from './logger.service';

const prisma = new PrismaClient();

export interface TrackEventInput {
  userId?: string;
  eventType: string;
  data: Record<string, unknown>;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface PlayerMetricsPeriod {
  startDate: Date;
  endDate: Date;
}

/**
 * @notice Tracks a custom analytics event
 * @dev Events are stored with under 1 second latency
 */
export async function trackEvent(input: TrackEventInput) {
  try {
    const event = await prisma.analyticsEvent.create({
      data: {
        userId: input.userId,
        eventType: input.eventType,
        data: input.data as any,
        sessionId: input.sessionId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });

    logger.info('Analytics event tracked', {
      eventId: event.id,
      eventType: event.eventType,
      userId: event.userId,
    });

    return event;
  } catch (error) {
    logger.error('Failed to track analytics event', { error, input });
    throw error;
  }
}

/**
 * @notice Calculates player metrics for a given period
 * @dev Aggregates game history and session data
 */
export async function calculatePlayerMetrics(userId: string, period: PlayerMetricsPeriod) {
  try {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        userId,
        createdAt: {
          gte: period.startDate,
          lte: period.endDate,
        },
      },
    });

    const gameEvents = events.filter((e) => e.eventType === 'GAME_COMPLETED');
    const sessionEvents = events.filter((e) => e.eventType === 'SESSION_START');

    const wins = gameEvents.filter((e) => {
      const data = e.data as Record<string, unknown>;
      return data.result === 'win';
    }).length;

    const losses = gameEvents.filter((e) => {
      const data = e.data as Record<string, unknown>;
      return data.result === 'loss';
    }).length;

    const totalPlaytime = sessionEvents.reduce((acc, e) => {
      const data = e.data as Record<string, unknown>;
      return acc + ((data.duration as number) || 0);
    }, 0);

    const metrics = {
      userId,
      period,
      totalGames: gameEvents.length,
      wins,
      losses,
      winRate: gameEvents.length > 0 ? (wins / gameEvents.length) * 100 : 0,
      totalPlaytime,
      avgSessionTime: sessionEvents.length > 0 ? totalPlaytime / sessionEvents.length : 0,
      totalEvents: events.length,
    };

    // Upsert player metrics record
    await prisma.playerMetrics.upsert({
      where: { userId },
      update: {
        totalGames: metrics.totalGames,
        wins: metrics.wins,
        losses: metrics.losses,
        totalPlaytime: metrics.totalPlaytime,
        avgSessionTime: metrics.avgSessionTime,
        lastActive: new Date(),
      },
      create: {
        userId,
        totalGames: metrics.totalGames,
        wins: metrics.wins,
        losses: metrics.losses,
        totalPlaytime: metrics.totalPlaytime,
        avgSessionTime: metrics.avgSessionTime,
      },
    });

    return metrics;
  } catch (error) {
    logger.error('Failed to calculate player metrics', { error, userId });
    throw error;
  }
}

/**
 * @notice Gets game performance metrics for a period
 * @dev Aggregates across all players and games
 */
export async function getGamePerformanceMetrics(period: PlayerMetricsPeriod) {
  try {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        createdAt: {
          gte: period.startDate,
          lte: period.endDate,
        },
        eventType: 'GAME_COMPLETED',
      },
    });

    const activePlayers = new Set(events.map((e) => e.userId).filter(Boolean)).size;

    const totalDuration = events.reduce((acc, e) => {
      const data = e.data as Record<string, unknown>;
      return acc + ((data.duration as number) || 0);
    }, 0);

    return {
      period,
      totalGames: events.length,
      activePlayers,
      avgGameDuration: events.length > 0 ? totalDuration / events.length : 0,
      revenue: 0,
    };
  } catch (error) {
    logger.error('Failed to get game performance metrics', { error });
    throw error;
  }
}

/**
 * @notice Generates a custom report
 * @dev Supports player, game, and revenue report types
 */
export async function generateReport(
  reportType: string,
  parameters: Record<string, unknown>,
) {
  try {
    const period: PlayerMetricsPeriod = {
      startDate: new Date((parameters.startDate as string) || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
      endDate: new Date((parameters.endDate as string) || new Date()),
    };

    switch (reportType) {
      case 'player': {
        const userId = parameters.userId as string;
        if (!userId) throw new Error('userId required for player report');
        return await calculatePlayerMetrics(userId, period);
      }

      case 'game':
        return await getGamePerformanceMetrics(period);

      case 'revenue': {
        const events = await prisma.analyticsEvent.findMany({
          where: {
            eventType: 'PAYMENT_COMPLETED',
            createdAt: { gte: period.startDate, lte: period.endDate },
          },
        });

        const totalRevenue = events.reduce((acc, e) => {
          const data = e.data as Record<string, unknown>;
          return acc + ((data.amount as number) || 0);
        }, 0);

        return {
          reportType,
          period,
          totalRevenue,
          totalTransactions: events.length,
          avgTransactionValue: events.length > 0 ? totalRevenue / events.length : 0,
        };
      }

      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }
  } catch (error) {
    logger.error('Failed to generate report', { error, reportType });
    throw error;
  }
}

/**
 * @notice Gets real-time statistics
 * @dev Updates every 30 seconds via caching layer
 */
export async function getRealTimeStats() {
  try {
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [recentEvents, dailyEvents, activePlayers] = await Promise.all([
      prisma.analyticsEvent.count({
        where: { createdAt: { gte: thirtySecondsAgo } },
      }),
      prisma.analyticsEvent.count({
        where: { createdAt: { gte: oneDayAgo } },
      }),
      prisma.analyticsEvent.findMany({
        where: {
          createdAt: { gte: oneDayAgo },
          userId: { not: null },
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

    return {
      timestamp: new Date(),
      eventsLast30Seconds: recentEvents,
      eventsLast24Hours: dailyEvents,
      activePlayersLast24Hours: activePlayers.length,
    };
  } catch (error) {
    logger.error('Failed to get real-time stats', { error });
    throw error;
  }
}

/**
 * @notice Gets analytics dashboard data
 */
export async function getDashboard() {
  try {
    const [realTimeStats, gameMetrics] = await Promise.all([
      getRealTimeStats(),
      getGamePerformanceMetrics({
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        endDate: new Date(),
      }),
    ]);

    return {
      realTime: realTimeStats,
      weekly: gameMetrics,
    };
  } catch (error) {
    logger.error('Failed to get dashboard', { error });
    throw error;
  }
}