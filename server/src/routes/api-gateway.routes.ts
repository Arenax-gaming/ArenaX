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
router.post('/keys', authenticateJWT, createApiKey);
router.get('/keys', authenticateJWT, listApiKeys);
router.delete('/keys/:id', authenticateJWT, revokeApiKey);
router.post('/keys/:id/rotate', authenticateJWT, rotateApiKey);
router.get('/keys/:id/usage', authenticateJWT, getApiKeyUsage);

// Admin routes
router.get('/admin/keys', authenticateJWT, restrictTo('ADMIN'), adminListAllKeys);
router.put('/admin/keys/:id/permissions', authenticateJWT, restrictTo('ADMIN'), adminUpdateKeyPermissions);
router.get('/admin/analytics', authenticateJWT, restrictTo('ADMIN'), getApiKeyAnalytics);

// Public API gateway endpoint (with API key)
router.get('/proxy/:endpoint', apiKeyAuth, apiKeyRateLimiter, trackApiUsage, (req: Request, res: Response) => {
  res.json({
    message: 'API Gateway proxy endpoint',
    endpoint: req.params.endpoint,
    apiKey: req.apiKeyInfo?.keyPrefix,
  });
});

export default router;
