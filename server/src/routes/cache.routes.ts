import { Router, Request, Response } from 'express';
import { authenticateJWT, restrictTo } from '../middleware/auth.middleware';
import { cdnCacheService } from '../services/cdn-cache.service';
import { cacheAnalyticsService } from '../services/cache-analytics.service';
import { cacheWarmingService } from '../services/cache-warming.service';
import { invalidateCdnCache } from '../middleware/cdn-cache.middleware';
import { cacheService } from '../services/cache.service';

const router: Router = Router();

router.use(authenticateJWT, restrictTo('ADMIN'));

router.get('/analytics', (_req: Request, res: Response) => {
  const analytics = cacheAnalyticsService.getCurrentAnalytics();
  const summary = cacheAnalyticsService.getSummary(24);
  const history = cacheAnalyticsService.getHistory(24);
  res.json({ analytics, summary, history });
});

router.get('/warming/status', (_req: Request, res: Response) => {
  res.json({
    stats: cacheWarmingService.getStats(),
    queueSize: cdnCacheService.getWarmingQueueSize(),
    warmingInProgress: cdnCacheService.isWarmingInProgress(),
    endpoints: cacheWarmingService.getEndpoints(),
  });
});

router.post('/warming/trigger', async (_req: Request, res: Response) => {
  await cacheWarmingService.warmAll();
  res.json({ message: 'Cache warming triggered', stats: cacheWarmingService.getStats() });
});

router.post('/purge', async (req: Request, res: Response) => {
  const { pattern, reason } = req.body as { pattern?: string; reason?: string };
  if (!pattern) {
    res.status(400).json({ error: 'pattern is required' });
    return;
  }
  const success = await invalidateCdnCache(pattern, reason ?? 'manual purge');
  res.json({ success, pattern, reason: reason ?? 'manual purge' });
});

router.post('/purge/all', async (req: Request, res: Response) => {
  const { reason } = req.body as { reason?: string };
  const success = await cdnCacheService.purgeAll(reason ?? 'manual full purge');
  await cacheService.clear();
  res.json({ success, reason: reason ?? 'manual full purge' });
});

router.get('/purge/history', (_req: Request, res: Response) => {
  res.json(cdnCacheService.getPurgeHistory());
});

router.get('/config', (_req: Request, res: Response) => {
  res.json({ config: cdnCacheService.getConfig() });
});

export default router;
