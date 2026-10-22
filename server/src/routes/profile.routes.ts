import { Router } from 'express';
import {
    getProfileByUsername,
    updateMyProfileController
} from '../controllers/profile.controller';
import {
    getMyPreferences,
    updatePreferences
} from '../controllers/notification.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { publicRateLimiter } from '../middleware/rate-limit.middleware';

const router: Router = Router();

router.get('/:username', publicRateLimiter, getProfileByUsername);
router.patch('/me', authenticateJWT, updateMyProfileController);
router.get('/me/preferences', authenticateJWT, getMyPreferences);
router.put('/me/preferences', authenticateJWT, updatePreferences);
router.post('/me/preferences', authenticateJWT, updatePreferences);
router.patch('/me/preferences', authenticateJWT, updatePreferences);

export default router;
