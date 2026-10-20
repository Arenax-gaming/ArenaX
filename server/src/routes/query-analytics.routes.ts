import { Router, Request, Response } from 'express';
import { getSlowQueries, getSlowQueryStats, clearSlowQueries } from '../services/slow-query-detector.service';
import { analyzeQuery, getRecommendedIndexes } from '../services/query-optimizer.service';
import { getAnalyticsSnapshot, resetAnalytics } from '../services/query-analytics.service';
import { getCacheStats, clearAllCache } from '../services/query-cache.service';
import { logger } from '../services/logger.service';

const router = Router();

/**
 * @openapi
 * /v1/query-analytics/analytics:
 *   get:
 *     summary: Get query analytics analytics
 *     tags: [QueryAnalytics]
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
  const snapshot = getAnalyticsSnapshot();
  res.json({ success: true, data: snapshot });
});

/**
 * @openapi
 * /v1/query-analytics/slow-queries:
 *   get:
 *     summary: Get query analytics slow queries
 *     tags: [QueryAnalytics]
 *     description: Requires role ADMIN.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *       - in: query
 *         name: offset
 *         required: false
 *         schema:
 *           type: integer
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
router.get('/slow-queries', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const queries = getSlowQueries(limit, offset);
  const stats = getSlowQueryStats();
  res.json({ success: true, data: { queries, stats, limit, offset } });
});

/**
 * @openapi
 * /v1/query-analytics/slow-queries:
 *   delete:
 *     summary: Delete query analytics slow queries
 *     tags: [QueryAnalytics]
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
router.delete('/slow-queries', (_req: Request, res: Response) => {
  clearSlowQueries();
  res.json({ success: true, message: 'Slow query log cleared' });
});

/**
 * @openapi
 * /v1/query-analytics/analyze:
 *   post:
 *     summary: Create query analytics analyze
 *     tags: [QueryAnalytics]
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
 *               query:
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

/**
 * @openapi
 * /v1/query-analytics/index-suggestions:
 *   get:
 *     summary: Get query analytics index suggestions
 *     tags: [QueryAnalytics]
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
router.get('/index-suggestions', async (_req: Request, res: Response) => {
  try {
    const suggestions = await getRecommendedIndexes();
    res.json({ success: true, data: suggestions });
  } catch (err) {
    logger.error('Index suggestions failed', { error: err });
    res.status(500).json({ success: false, error: 'Failed to get index suggestions' });
  }
});

/**
 * @openapi
 * /v1/query-analytics/cache:
 *   get:
 *     summary: Get query analytics cache
 *     tags: [QueryAnalytics]
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
router.get('/cache', async (_req: Request, res: Response) => {
  const stats = await getCacheStats();
  res.json({ success: true, data: stats });
});

/**
 * @openapi
 * /v1/query-analytics/cache:
 *   delete:
 *     summary: Delete query analytics cache
 *     tags: [QueryAnalytics]
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
router.delete('/cache', async (_req: Request, res: Response) => {
  await clearAllCache();
  res.json({ success: true, message: 'Query cache cleared' });
});

/**
 * @openapi
 * /v1/query-analytics/analytics:
 *   delete:
 *     summary: Delete query analytics analytics
 *     tags: [QueryAnalytics]
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
router.delete('/analytics', (_req: Request, res: Response) => {
  resetAnalytics();
  res.json({ success: true, message: 'Query analytics reset' });
});

export default router;
