/**
 * Analytics service (#281).
 *
 * Tracks player behaviour, game performance, and business metrics. The
 * service intentionally avoids a heavy stream-processing dependency for
 * now: events land in an in-memory ring buffer that the controller can
 * drain via the dashboard / report endpoints, and the same buffer feeds
 * the real-time stats endpoint. Production hardening (Redis / Kafka /
 * ClickHouse) is a follow-up and noted in the PR body.
 *
 * The shape of `trackEvent` / `calculatePlayerMetrics` / etc. matches
 * the issue's spec so a future swap to a real pipeline is a drop-in
 * replacement: the controller and routes don't need to change.
 */

import { v4 as uuid } from 'uuid';

export type AnalyticsEventType =
    | 'match_started'
    | 'match_completed'
    | 'tournament_registered'
    | 'achievement_unlocked'
    | 'wallet_funded'
    | 'session_started'
    | 'session_ended'
    | 'custom';

export interface AnalyticsEvent {
    id: string;
    userId: string;
    eventType: AnalyticsEventType;
    data: Record<string, unknown>;
    timestamp: number;
}

export interface PlayerMetrics {
    userId: string;
    period: AnalyticsPeriod;
    eventCounts: Record<string, number>;
    totalEvents: number;
    firstEventAt: number | null;
    lastEventAt: number | null;
}

export interface GamePerformanceMetrics {
    period: AnalyticsPeriod;
    matchesStarted: number;
    matchesCompleted: number;
    completionRate: number;
    averageMatchDurationMs: number | null;
}

export interface AnalyticsDashboard {
    totalEvents: number;
    uniquePlayers: number;
    eventBreakdown: Record<string, number>;
    generatedAt: number;
}

export type AnalyticsPeriod = '1h' | '24h' | '7d' | '30d' | 'all';

export interface RealTimeStats {
    eventsLastMinute: number;
    eventsLast5Min: number;
    activePlayersLast5Min: number;
    backlogSize: number;
    capturedAt: number;
}

export type ReportType =
    | 'player-engagement'
    | 'match-throughput'
    | 'tournament-funnel'
    | 'achievement-velocity';

export interface AnalyticsReport {
    reportType: ReportType;
    parameters: Record<string, unknown>;
    rows: Array<Record<string, unknown>>;
    generatedAt: number;
    durationMs: number;
}

const MAX_EVENT_RETENTION = 100_000;

/**
 * Window selectors for the analytics period strings. Returns the
 * cutoff timestamp (events older than this are ignored for that
 * window), or `null` for `'all'`.
 */
const cutoffFor = (period: AnalyticsPeriod, now: number): number | null => {
    switch (period) {
        case '1h':
            return now - 60 * 60 * 1000;
        case '24h':
            return now - 24 * 60 * 60 * 1000;
        case '7d':
            return now - 7 * 24 * 60 * 60 * 1000;
        case '30d':
            return now - 30 * 24 * 60 * 60 * 1000;
        case 'all':
            return null;
    }
};

/**
 * Create a new analytics service instance. Factory style so tests can
 * spin up isolated instances; production uses `defaultAnalyticsService`.
 */
export const createAnalyticsService = (
    options: { now?: () => number; maxEventRetention?: number } = {}
) => {
    const now = options.now ?? (() => Date.now());
    const maxRetention = options.maxEventRetention ?? MAX_EVENT_RETENTION;

    // Ring buffer of events. We trim from the head when we exceed the
    // retention cap so memory stays bounded under the issue's 1M+
    // events/day load expectation.
    const events: AnalyticsEvent[] = [];

    const trackEvent = async (
        userId: string,
        eventType: AnalyticsEventType,
        data: Record<string, unknown> = {}
    ): Promise<AnalyticsEvent> => {
        const event: AnalyticsEvent = {
            id: uuid(),
            userId,
            eventType,
            data,
            timestamp: now(),
        };
        events.push(event);
        if (events.length > maxRetention) {
            events.splice(0, events.length - maxRetention);
        }
        return event;
    };

    const eventsInWindow = (period: AnalyticsPeriod): AnalyticsEvent[] => {
        const cutoff = cutoffFor(period, now());
        if (cutoff == null) return events.slice();
        return events.filter(e => e.timestamp >= cutoff);
    };

    const calculatePlayerMetrics = async (
        userId: string,
        period: AnalyticsPeriod
    ): Promise<PlayerMetrics> => {
        const windowEvents = eventsInWindow(period).filter(
            e => e.userId === userId
        );
        const eventCounts: Record<string, number> = {};
        let firstEventAt: number | null = null;
        let lastEventAt: number | null = null;

        for (const event of windowEvents) {
            eventCounts[event.eventType] = (eventCounts[event.eventType] ?? 0) + 1;
            if (firstEventAt == null || event.timestamp < firstEventAt) {
                firstEventAt = event.timestamp;
            }
            if (lastEventAt == null || event.timestamp > lastEventAt) {
                lastEventAt = event.timestamp;
            }
        }

        return {
            userId,
            period,
            eventCounts,
            totalEvents: windowEvents.length,
            firstEventAt,
            lastEventAt,
        };
    };

    const getGamePerformanceMetrics = async (
        period: AnalyticsPeriod
    ): Promise<GamePerformanceMetrics> => {
        const windowEvents = eventsInWindow(period);

        let matchesStarted = 0;
        let matchesCompleted = 0;
        const startsByMatch = new Map<string, number>();
        const durationsMs: number[] = [];

        for (const event of windowEvents) {
            if (event.eventType === 'match_started') {
                matchesStarted += 1;
                const matchId = String(event.data['matchId'] ?? '');
                if (matchId) startsByMatch.set(matchId, event.timestamp);
            } else if (event.eventType === 'match_completed') {
                matchesCompleted += 1;
                const matchId = String(event.data['matchId'] ?? '');
                const startedAt = startsByMatch.get(matchId);
                if (startedAt != null) {
                    durationsMs.push(event.timestamp - startedAt);
                    startsByMatch.delete(matchId);
                }
            }
        }

        const averageMatchDurationMs =
            durationsMs.length === 0
                ? null
                : Math.round(
                      durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length
                  );

        return {
            period,
            matchesStarted,
            matchesCompleted,
            completionRate:
                matchesStarted === 0 ? 0 : matchesCompleted / matchesStarted,
            averageMatchDurationMs,
        };
    };

    const getDashboard = async (
        period: AnalyticsPeriod = '24h'
    ): Promise<AnalyticsDashboard> => {
        const windowEvents = eventsInWindow(period);
        const eventBreakdown: Record<string, number> = {};
        const uniquePlayers = new Set<string>();
        for (const event of windowEvents) {
            eventBreakdown[event.eventType] =
                (eventBreakdown[event.eventType] ?? 0) + 1;
            uniquePlayers.add(event.userId);
        }
        return {
            totalEvents: windowEvents.length,
            uniquePlayers: uniquePlayers.size,
            eventBreakdown,
            generatedAt: now(),
        };
    };

    const getRealTimeStats = async (): Promise<RealTimeStats> => {
        const t = now();
        const lastMinute = t - 60 * 1000;
        const last5Min = t - 5 * 60 * 1000;
        let eventsLastMinute = 0;
        let eventsLast5Min = 0;
        const activePlayersLast5Min = new Set<string>();
        for (const event of events) {
            if (event.timestamp >= last5Min) {
                eventsLast5Min += 1;
                activePlayersLast5Min.add(event.userId);
                if (event.timestamp >= lastMinute) {
                    eventsLastMinute += 1;
                }
            }
        }
        return {
            eventsLastMinute,
            eventsLast5Min,
            activePlayersLast5Min: activePlayersLast5Min.size,
            backlogSize: events.length,
            capturedAt: t,
        };
    };

    /**
     * Report generation pipeline. Each report type is a small pure
     * function over the event stream; adding a new report type is a
     * matter of adding a new branch.
     */
    const generateReport = async (
        reportType: ReportType,
        parameters: Record<string, unknown> = {}
    ): Promise<AnalyticsReport> => {
        const t0 = now();
        const period =
            (parameters['period'] as AnalyticsPeriod | undefined) ?? '24h';
        const windowEvents = eventsInWindow(period);
        let rows: Array<Record<string, unknown>> = [];

        switch (reportType) {
            case 'player-engagement': {
                const byUser = new Map<string, number>();
                for (const event of windowEvents) {
                    byUser.set(event.userId, (byUser.get(event.userId) ?? 0) + 1);
                }
                rows = Array.from(byUser.entries())
                    .map(([userId, eventCount]) => ({ userId, eventCount }))
                    .sort(
                        (a, b) =>
                            (b.eventCount as number) - (a.eventCount as number)
                    );
                break;
            }
            case 'match-throughput': {
                const perf = await getGamePerformanceMetrics(period);
                rows = [
                    {
                        matchesStarted: perf.matchesStarted,
                        matchesCompleted: perf.matchesCompleted,
                        completionRate: perf.completionRate,
                        averageMatchDurationMs: perf.averageMatchDurationMs,
                    },
                ];
                break;
            }
            case 'tournament-funnel': {
                const counts = { registered: 0, started: 0, completed: 0 };
                for (const event of windowEvents) {
                    if (event.eventType === 'tournament_registered')
                        counts.registered += 1;
                    if (event.eventType === 'match_started') counts.started += 1;
                    if (event.eventType === 'match_completed')
                        counts.completed += 1;
                }
                rows = [counts];
                break;
            }
            case 'achievement-velocity': {
                const byHour = new Map<number, number>();
                for (const event of windowEvents) {
                    if (event.eventType !== 'achievement_unlocked') continue;
                    const hour = Math.floor(event.timestamp / 3_600_000);
                    byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
                }
                rows = Array.from(byHour.entries())
                    .map(([hour, count]) => ({
                        hourBucket: hour * 3_600_000,
                        count,
                    }))
                    .sort(
                        (a, b) =>
                            (a.hourBucket as number) - (b.hourBucket as number)
                    );
                break;
            }
        }

        return {
            reportType,
            parameters,
            rows,
            generatedAt: t0,
            durationMs: now() - t0,
        };
    };

    return {
        trackEvent,
        calculatePlayerMetrics,
        getGamePerformanceMetrics,
        getDashboard,
        getRealTimeStats,
        generateReport,
        _events: events, // exposed for diagnostic / test use only
    };
};

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;

/**
 * Default singleton used by the controller. Tests should call
 * `createAnalyticsService()` directly to get an isolated instance.
 */
export const defaultAnalyticsService = createAnalyticsService();
