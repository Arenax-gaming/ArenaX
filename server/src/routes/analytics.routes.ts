/**
 * Analytics routes (#281, #689). All endpoints are JWT-protected — the
 * dashboard surfaces aggregated game-engagement data and should not be
 * world-readable. `trackEvent` accepts unauthenticated `userId` in the
 * body so client-side instrumentation (e.g. a guest visiting the
 * landing page) can fire events; the controller still requires an
 * authenticated session at the route level so we don't accept anonymous
 * traffic against a production endpoint.
 */

import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { paymentRateLimiter, publicRateLimiter } from '../middleware/rate-limit.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import defaultAnalyticsController from '../controllers/analytics.controller';
import { defaultAnalyticsService, AnalyticsPeriod } from '../services/analytics.service';

const router: Router = Router();

router.use(authenticateJWT);

router.post(
    '/events',
    paymentRateLimiter,
    defaultAnalyticsController.trackEvent.bind(defaultAnalyticsController)
);
router.get(
    '/dashboard',
    publicRateLimiter,
    defaultAnalyticsController.getDashboard.bind(defaultAnalyticsController)
);
router.get(
    '/players/:id',
    publicRateLimiter,
    defaultAnalyticsController.getPlayerAnalytics.bind(defaultAnalyticsController)
);
router.get(
    '/games/metrics',
    publicRateLimiter,
    defaultAnalyticsController.getGameMetrics.bind(defaultAnalyticsController)
);
router.get(
    '/reports/:type',
    publicRateLimiter,
    defaultAnalyticsController.getReport.bind(defaultAnalyticsController)
);

// ── Data Aggregation Endpoints (#689) ──────────────────────────────────────

router.get(
    '/aggregated',
    requirePermission('analytics:read'),
    async (req, res) => {
        const period = (req.query.period as AnalyticsPeriod) || '24h';
        const metrics = await defaultAnalyticsService.getAggregatedMetrics(period);
        res.json(metrics);
    }
);

router.get(
    '/cohorts',
    requirePermission('analytics:read'),
    async (req, res) => {
        const cohortDays = parseInt(req.query.days as string) || 7;
        const cohorts = await defaultAnalyticsService.getCohortRetention(cohortDays);
        res.json({ cohorts, count: cohorts.length });
    }
);

router.get(
    '/privacy',
    requirePermission('analytics:read'),
    async (req, res) => {
        const names = (req.query.metrics as string)?.split(',') || [
            'total_matches',
            'unique_players',
            'total_volume',
        ];
        const epsilon = parseFloat(req.query.epsilon as string) || 1.0;
        const metrics = await defaultAnalyticsService.getPrivacyPreservingMetrics(names, epsilon);
        res.json({ metrics });
    }
);

router.get(
    '/health',
    requirePermission('analytics:read'),
    async (_req, res) => {
        const health = await defaultAnalyticsService.getAnalyticsHealth();
        res.json(health);
    }
);

export default router;
