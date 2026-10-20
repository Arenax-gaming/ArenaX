import { Router, Request, Response } from 'express';
import { authenticateJWT, restrictTo } from '../middleware/auth.middleware';
import { apiKeyAuth, apiKeyRateLimiter, trackApiUsage } from '../middleware/api-gateway.middleware';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  getApiKeyAnalytics,
  getApiKeyUsage,
  adminListAllKeys,
  adminUpdateKeyPermissions,
} from '../controllers/api-gateway.controller';

const router: Router = Router();

// User-facing API key management
/**
 * @openapi
 * /v1/gateway/keys:
 *   post:
 *     summary: User-facing API key management
 *     tags: [ApiGateway]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               permissions:
 *                 type: array
 *                 items: {}
 *               expiresInDays:
 *                 type: integer
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
router.post('/keys', authenticateJWT, createApiKey);
/**
 * @openapi
 * /v1/gateway/keys:
 *   get:
 *     summary: List Api Keys
 *     tags: [ApiGateway]
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
router.get('/keys', authenticateJWT, listApiKeys);
/**
 * @openapi
 * /v1/gateway/keys/{id}:
 *   delete:
 *     summary: Revoke Api Key
 *     tags: [ApiGateway]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
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
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Resource not found
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
router.delete('/keys/:id', authenticateJWT, revokeApiKey);
/**
 * @openapi
 * /v1/gateway/keys/{id}/rotate:
 *   post:
 *     summary: Rotate Api Key
 *     tags: [ApiGateway]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
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
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Resource not found
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
router.post('/keys/:id/rotate', authenticateJWT, rotateApiKey);
/**
 * @openapi
 * /v1/gateway/keys/{id}/usage:
 *   get:
 *     summary: Get Api Key Usage
 *     tags: [ApiGateway]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
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
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Resource not found
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
router.get('/keys/:id/usage', authenticateJWT, getApiKeyUsage);

// Admin routes
/**
 * @openapi
 * /v1/gateway/admin/keys:
 *   get:
 *     summary: Admin routes
 *     tags: [ApiGateway]
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
router.get('/admin/keys', authenticateJWT, restrictTo('ADMIN'), adminListAllKeys);
/**
 * @openapi
 * /v1/gateway/admin/keys/{id}/permissions:
 *   put:
 *     summary: Admin Update Key Permissions
 *     tags: [ApiGateway]
 *     description: Requires role ADMIN.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               permissions:
 *                 type: array
 *                 items: {}
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
 *       '404':
 *         description: Resource not found
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
router.put('/admin/keys/:id/permissions', authenticateJWT, restrictTo('ADMIN'), adminUpdateKeyPermissions);
/**
 * @openapi
 * /v1/gateway/admin/analytics:
 *   get:
 *     summary: Get Api Key Analytics
 *     tags: [ApiGateway]
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
router.get('/admin/analytics', authenticateJWT, restrictTo('ADMIN'), getApiKeyAnalytics);

// Public API gateway endpoint (with API key)
/**
 * @openapi
 * /v1/gateway/proxy/{endpoint}:
 *   get:
 *     summary: Public API gateway endpoint (with API key)
 *     tags: [ApiGateway]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: endpoint
 *         required: true
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
 *       '404':
 *         description: Resource not found
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
router.get('/proxy/:endpoint', apiKeyAuth, apiKeyRateLimiter, trackApiUsage, (req: Request, res: Response) => {
  res.json({
    message: 'API Gateway proxy endpoint',
    endpoint: req.params.endpoint,
    apiKey: req.apiKeyInfo?.keyPrefix,
  });
});

export default router;
