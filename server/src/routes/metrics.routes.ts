import { Router, Request, Response } from 'express';
import { metricsService } from '../services/metrics.service';
import { logger } from '../services/logger.service';

const router = Router();

// Prometheus metrics endpoint for scraping
router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const metrics = await metricsService.getMetrics();
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (error) {
    logger.error('Error generating metrics', { error });
    res.status(500).send('Error generating metrics');
  }
});

// Metrics summary endpoint for dashboard
router.get('/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await metricsService.getMetricSummary();
    res.json(summary);
  } catch (error) {
    logger.error('Error generating metrics summary', { error });
    res.status(500).json({ error: 'Error generating metrics summary' });
  }
});

export default router;
