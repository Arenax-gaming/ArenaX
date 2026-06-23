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

router.get('/', publicRateLimiter, searchController.search.bind(searchController));
router.get('/autocomplete', publicRateLimiter, searchController.autocomplete.bind(searchController));
router.post('/index', authenticateJWT, searchController.indexDocument.bind(searchController));
router.get('/analytics', authenticateJWT, searchController.getAnalytics.bind(searchController));

export default router;
