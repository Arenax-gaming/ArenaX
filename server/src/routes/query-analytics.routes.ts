import { Router, Request, Response } from 'express';
import { getSlowQueries, getSlowQueryStats, clearSlowQueries } from '../services/slow-query-detector.service';
import { analyzeQuery, getRecommendedIndexes } from '../services/query-optimizer.service';
import { getAnalyticsSnapshot, resetAnalytics } from '../services/query-analytics.service';
import { getCacheStats, clearAllCache } from '../services/query-cache.service';
import { logger } from '../services/logger.service';

const router = Router();

router.get('/analytics', (_req: Request, res: Response) => {
  const snapshot = getAnalyticsSnapshot();
  res.json({ success: true, data: snapshot });
});

router.get('/slow-queries', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const queries = getSlowQueries(limit, offset);
  const stats = getSlowQueryStats();
  res.json({ success: true, data: { queries, stats, limit, offset } });
});

router.delete('/slow-queries', (_req: Request, res: Response) => {
  clearSlowQueries();
  res.json({ success: true, message: 'Slow query log cleared' });
});

router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ success: false, error: 'query string required' });
      return;
    }
    const plan = await analyzeQuery(query);
    res.json({ success: true, data: plan });
  } catch (err) {
    logger.error('Query analysis failed', { error: err });
    res.status(500).json({ success: false, error: 'Query analysis failed' });
  }
});

router.get('/index-suggestions', async (_req: Request, res: Response) => {
  try {
    const suggestions = await getRecommendedIndexes();
    res.json({ success: true, data: suggestions });
  } catch (err) {
    logger.error('Index suggestions failed', { error: err });
    res.status(500).json({ success: false, error: 'Failed to get index suggestions' });
  }
});

router.get('/cache', async (_req: Request, res: Response) => {
  const stats = await getCacheStats();
  res.json({ success: true, data: stats });
});

router.delete('/cache', async (_req: Request, res: Response) => {
  await clearAllCache();
  res.json({ success: true, message: 'Query cache cleared' });
});

router.delete('/analytics', (_req: Request, res: Response) => {
  resetAnalytics();
  res.json({ success: true, message: 'Query analytics reset' });
});

export default router;
