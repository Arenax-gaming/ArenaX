import { Router } from 'express';
import { reportScore, raiseDispute } from '../controllers/match.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { paymentRateLimiter } from '../middleware/rate-limit.middleware';

const router: Router = Router();

router.use(authenticateJWT);

router.post('/:id/report', paymentRateLimiter, reportScore);
router.post('/:id/dispute', paymentRateLimiter, raiseDispute);

export default router;
