/**
 * Search routes (#473).
 *
 * GET  /v1/search                — full-text search with filters
 * GET  /v1/search/autocomplete   — prefix suggestions
 * POST /v1/search/index          — index a document (admin only)
 * GET  /v1/search/analytics      — query analytics (admin only)
 */

import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { publicRateLimiter } from '../middleware/rate-limit.middleware';
import searchController from '../controllers/search.controller';

const router: Router = Router();

/**
 * @openapi
 * /v1/search:
 *   get:
 *     summary: Search
 *     tags: [Search]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *       - in: query
 *         name: pageSize
 *         required: false
 *         schema:
 *           type: integer
 *       - in: query
 *         name: highlight
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: entity
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: tags
 *         required: false
 *         schema:
 *           type: array
 *           items: {}
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
 *       '429':
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RateLimitError'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', publicRateLimiter, searchController.search.bind(searchController));
/**
 * @openapi
 * /v1/search/autocomplete:
 *   get:
 *     summary: Autocomplete
 *     tags: [Search]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: entity
 *         required: false
 *         schema:
 *           type: string
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
 *       '429':
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RateLimitError'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/autocomplete', publicRateLimiter, searchController.autocomplete.bind(searchController));
/**
 * @openapi
 * /v1/search/index:
 *   post:
 *     summary: Index Document
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               entity:
 *                 type: string
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items: {}
 *               metadata:
 *                 type: object
 *     responses:
 *       '201':
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
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/index', authenticateJWT, searchController.indexDocument.bind(searchController));
/**
 * @openapi
 * /v1/search/analytics:
 *   get:
 *     summary: Get Analytics
 *     tags: [Search]
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
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/analytics', authenticateJWT, searchController.getAnalytics.bind(searchController));

export default router;
