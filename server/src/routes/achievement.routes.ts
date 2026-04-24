import { Router } from 'express';
import {
    getAchievementStats,
    getPlayerAchievements,
    listAchievements,
    postAchievementProgress,
    shareAchievement
} from '../controllers/achievement.controller';
import { authenticateJWT, optionalAuthenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.get('/', listAchievements);
router.get('/player/:playerId', optionalAuthenticateJWT, getPlayerAchievements);
router.get('/:id/stats', getAchievementStats);
router.post('/:id/progress', authenticateJWT, postAchievementProgress);
router.post('/share/:id', authenticateJWT, shareAchievement);

export default router;
