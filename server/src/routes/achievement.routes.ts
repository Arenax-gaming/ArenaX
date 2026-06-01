import { Router } from 'express';
import {
    getAchievementStats,
    getPlayerAchievements,
    listAchievements,
    postAchievementProgress,
    shareAchievement
} from '../controllers/achievement.controller';
import { authenticateJWT, optionalAuthenticateJWT } from '../middleware/auth.middleware';
import { publicRateLimiter, paymentRateLimiter } from '../middleware/rate-limit.middleware';

const router: Router = Router();

router.get('/', publicRateLimiter, listAchievements);
router.get('/player/:playerId', optionalAuthenticateJWT, publicRateLimiter, getPlayerAchievements);
router.get('/:id/stats', publicRateLimiter, getAchievementStats);
router.post('/:id/progress', authenticateJWT, paymentRateLimiter, postAchievementProgress);
router.post('/share/:id', authenticateJWT, paymentRateLimiter, shareAchievement);

export default router;
