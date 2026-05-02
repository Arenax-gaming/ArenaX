import { Router } from 'express';
import {
  trackEventHandler,
  getDashboardHandler,
  getPlayerAnalyticsHandler,
  getGameMetricsHandler,
  generateReportHandler,
  getRealTimeStatsHandler,
} from '../controllers/analytics.controller';

const router = Router();

/**
 * @notice POST /api/v1/analytics/events
 * Track a custom analytics event
 */
router.post('/events', trackEventHandler);

/**
 * @notice GET /api/v1/analytics/dashboard
 * Get analytics dashboard data
 */
router.get('/dashboard', getDashboardHandler);

/**
 * @notice GET /api/v1/analytics/players/:id
 * Get player analytics
 */
router.get('/players/:id', getPlayerAnalyticsHandler);

/**
 * @notice GET /api/v1/analytics/games/metrics
 * Get game performance metrics
 */
router.get('/games/metrics', getGameMetricsHandler);

/**
 * @notice GET /api/v1/analytics/reports/:type
 * Generate a custom report
 */
router.get('/reports/:type', generateReportHandler);

/**
 * @notice GET /api/v1/analytics/realtime
 * Get real-time statistics
 */
router.get('/realtime', getRealTimeStatsHandler);

export default router;