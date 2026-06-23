/**
 * Analytics routes (#281). All endpoints are JWT-protected — the
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
import defaultAnalyticsController from '../controllers/analytics.controller';

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

export default router;
