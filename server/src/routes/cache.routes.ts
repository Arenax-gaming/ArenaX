import { Router, Request, Response } from 'express';
import { authenticateJWT, restrictTo } from '../middleware/auth.middleware';
import { cdnCacheService } from '../services/cdn-cache.service';
import { cacheAnalyticsService } from '../services/cache-analytics.service';
import { cacheWarmingService } from '../services/cache-warming.service';
import { invalidateCdnCache } from '../middleware/cdn-cache.middleware';
import { cacheService } from '../services/cache.service';

const router: Router = Router();

router.use(authenticateJWT, restrictTo('ADMIN'));

/**
 * @openapi
 * /v1/cache/analytics:
 *   get:
 *     summary: Get cache analytics
 *     tags: [Cache]
 *     description: Requires role ADMIN.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/analytics', (_req: Request, res: Response) => {
  const analytics = cacheAnalyticsService.getCurrentAnalytics();
  const summary = cacheAnalyticsService.getSummary(24);
  const history = cacheAnalyticsService.getHistory(24);
  res.json({ analytics, summary, history });
});

/**
 * @openapi
 * /v1/cache/warming/status:
 *   get:
 *     summary: Get warming status
 *     tags: [Cache]
 *     description: Requires role ADMIN.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/warming/status', (_req: Request, res: Response) => {
  res.json({
    stats: cacheWarmingService.getStats(),
    queueSize: cdnCacheService.getWarmingQueueSize(),
    warmingInProgress: cdnCacheService.isWarmingInProgress(),
    endpoints: cacheWarmingService.getEndpoints(),
  });
});

/**
 * @openapi
 * /v1/cache/warming/trigger:
 *   post:
 *     summary: Create warming trigger
 *     tags: [Cache]
 *     description: Requires role ADMIN.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/warming/trigger', async (_req: Request, res: Response) => {
  await cacheWarmingService.warmAll();
  res.json({ message: 'Cache warming triggered', stats: cacheWarmingService.getStats() });
});

/**
 * @openapi
 * /v1/cache/purge:
 *   post:
 *     summary: Create cache purge
 *     tags: [Cache]
 *     description: Requires role ADMIN.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pattern:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/purge', async (req: Request, res: Response) => {
  const { pattern, reason } = req.body as { pattern?: string; reason?: string };
  if (!pattern) {
    res.status(400).json({ error: 'pattern is required' });
    return;
  }
  const success = await invalidateCdnCache(pattern, reason ?? 'manual purge');
  res.json({ success, pattern, reason: reason ?? 'manual purge' });
});

/**
 * @openapi
 * /v1/cache/purge/all:
 *   post:
 *     summary: Create purge all
 *     tags: [Cache]
 *     description: Requires role ADMIN.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/purge/all', async (req: Request, res: Response) => {
  const { reason } = req.body as { reason?: string };
  const success = await cdnCacheService.purgeAll(reason ?? 'manual full purge');
  await cacheService.clear();
  res.json({ success, reason: reason ?? 'manual full purge' });
});

/**
 * @openapi
 * /v1/cache/purge/history:
 *   get:
 *     summary: Get purge history
 *     tags: [Cache]
 *     description: Requires role ADMIN.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/purge/history', (_req: Request, res: Response) => {
  res.json(cdnCacheService.getPurgeHistory());
});

/**
 * @openapi
 * /v1/cache/config:
 *   get:
 *     summary: Get cache config
 *     tags: [Cache]
 *     description: Requires role ADMIN.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/config', (_req: Request, res: Response) => {
  res.json({ config: cdnCacheService.getConfig() });
});

export default router;
