import { Request, Response } from 'express';
import {
  trackEvent,
  calculatePlayerMetrics,
  getGamePerformanceMetrics,
  generateReport,
  getRealTimeStats,
  getDashboard,
} from '../services/analytics.service';
import { logger } from '../services/logger.service';

/**
 * @notice POST /api/v1/analytics/events
 * @dev Track a custom analytics event
 */
export async function trackEventHandler(req: Request, res: Response) {
  try {
    const { eventType, data, sessionId } = req.body;

    if (!eventType) {
      return res.status(400).json({ error: 'eventType is required' });
    }

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'data must be an object' });
    }

    const event = await trackEvent({
      userId: (req as any).user?.id,
      eventType,
      data,
      sessionId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({ success: true, eventId: event.id });
  } catch (error) {
    logger.error('trackEventHandler error', { error });
    return res.status(500).json({ error: 'Failed to track event' });
  }
}

/**
 * @notice GET /api/v1/analytics/dashboard
 * @dev Get analytics dashboard data
 */
export async function getDashboardHandler(req: Request, res: Response) {
  try {
    const dashboard = await getDashboard();
    return res.json(dashboard);
  } catch (error) {
    logger.error('getDashboardHandler error', { error });
    return res.status(500).json({ error: 'Failed to get dashboard' });
  }
}

/**
 * @notice GET /api/v1/analytics/players/:id
 * @dev Get player analytics for a specific user
 */
export async function getPlayerAnalyticsHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const period = {
      startDate: startDate
        ? new Date(startDate as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate: endDate ? new Date(endDate as string) : new Date(),
    };

    const metrics = await calculatePlayerMetrics(id, period);
    return res.json(metrics);
  } catch (error) {
    logger.error('getPlayerAnalyticsHandler error', { error });
    return res.status(500).json({ error: 'Failed to get player analytics' });
  }
}

/**
 * @notice GET /api/v1/analytics/games/metrics
 * @dev Get game performance metrics
 */
export async function getGameMetricsHandler(req: Request, res: Response) {
  try {
    const { startDate, endDate } = req.query;

    const period = {
      startDate: startDate
        ? new Date(startDate as string)
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate: endDate ? new Date(endDate as string) : new Date(),
    };

    const metrics = await getGamePerformanceMetrics(period);
    return res.json(metrics);
  } catch (error) {
    logger.error('getGameMetricsHandler error', { error });
    return res.status(500).json({ error: 'Failed to get game metrics' });
  }
}

/**
 * @notice GET /api/v1/analytics/reports/:type
 * @dev Generate a custom report
 */
export async function generateReportHandler(req: Request, res: Response) {
  try {
    const { type } = req.params;
    const parameters = req.query as Record<string, unknown>;

    const report = await generateReport(type, parameters);
    return res.json(report);
  } catch (error: any) {
    logger.error('generateReportHandler error', { error });
    if (error.message?.includes('Unknown report type')) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to generate report' });
  }
}

/**
 * @notice GET /api/v1/analytics/realtime
 * @dev Get real-time statistics
 */
export async function getRealTimeStatsHandler(req: Request, res: Response) {
  try {
    const stats = await getRealTimeStats();
    return res.json(stats);
  } catch (error) {
    logger.error('getRealTimeStatsHandler error', { error });
    return res.status(500).json({ error: 'Failed to get real-time stats' });
  }
}