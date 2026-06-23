/**
 * Analytics controller (#281). Surfaces the 5 endpoints listed in the
 * issue spec. Each method is a thin pass-through to
 * `analytics.service.ts` — the controller owns input validation and
 * HTTP shape, the service owns the analytics math.
 */

import { Request, Response, NextFunction } from 'express';
import {
    AnalyticsEventType,
    AnalyticsPeriod,
    ReportType,
    defaultAnalyticsService,
} from '../services/analytics.service';

const VALID_PERIODS: ReadonlySet<AnalyticsPeriod> = new Set([
    '1h',
    '24h',
    '7d',
    '30d',
    'all',
]);

const VALID_REPORT_TYPES: ReadonlySet<ReportType> = new Set([
    'player-engagement',
    'match-throughput',
    'tournament-funnel',
    'achievement-velocity',
]);

const parsePeriod = (raw: unknown, fallback: AnalyticsPeriod = '24h'): AnalyticsPeriod => {
    if (typeof raw === 'string' && VALID_PERIODS.has(raw as AnalyticsPeriod)) {
        return raw as AnalyticsPeriod;
    }
    return fallback;
};

export class AnalyticsController {
    constructor(private readonly service = defaultAnalyticsService) {}

    /**
     * POST /api/v1/analytics/events
     * Track a custom event. Anonymous tracking is supported via the
     * `userId` body field for clients that don't carry a JWT yet; an
     * authenticated request overrides the body-supplied id.
     */
    async trackEvent(req: Request, res: Response, next: NextFunction) {
        try {
            const authedUserId = req.user?.id;
            const { userId: bodyUserId, eventType, data } = req.body ?? {};
            const userId = authedUserId ?? bodyUserId;
            if (typeof userId !== 'string' || userId.length === 0) {
                res.status(400).json({ error: 'userId is required' });
                return;
            }
            if (typeof eventType !== 'string' || eventType.length === 0) {
                res.status(400).json({ error: 'eventType is required' });
                return;
            }
            const event = await this.service.trackEvent(
                userId,
                eventType as AnalyticsEventType,
                (data as Record<string, unknown>) ?? {}
            );
            res.status(201).json({ event });
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/analytics/dashboard?period=24h
     */
    async getDashboard(req: Request, res: Response, next: NextFunction) {
        try {
            const period = parsePeriod(req.query.period);
            const dashboard = await this.service.getDashboard(period);
            const realTime = await this.service.getRealTimeStats();
            res.json({ period, dashboard, realTime });
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/analytics/players/:id?period=24h
     */
    async getPlayerAnalytics(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.params.id;
            if (!userId) {
                res.status(400).json({ error: 'player id is required' });
                return;
            }
            const period = parsePeriod(req.query.period);
            const metrics = await this.service.calculatePlayerMetrics(userId, period);
            res.json({ metrics });
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/analytics/games/metrics?period=24h
     */
    async getGameMetrics(req: Request, res: Response, next: NextFunction) {
        try {
            const period = parsePeriod(req.query.period);
            const metrics = await this.service.getGamePerformanceMetrics(period);
            res.json({ metrics });
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/analytics/reports/:type?period=24h
     */
    async getReport(req: Request, res: Response, next: NextFunction) {
        try {
            const reportType = req.params.type as ReportType;
            if (!VALID_REPORT_TYPES.has(reportType)) {
                res.status(400).json({
                    error: 'Unknown report type',
                    supported: Array.from(VALID_REPORT_TYPES),
                });
                return;
            }
            const parameters: Record<string, unknown> = {
                period: parsePeriod(req.query.period),
                ...(req.query as Record<string, unknown>),
            };
            const report = await this.service.generateReport(reportType, parameters);
            res.json({ report });
        } catch (err) {
            next(err);
        }
    }
}

export const defaultAnalyticsController = new AnalyticsController();
export default defaultAnalyticsController;
