import { Router } from 'express';
import {
    getProfileByUsername,
    updateMyProfileController
} from '../controllers/profile.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { publicRateLimiter } from '../middleware/rate-limit.middleware';

const router: Router = Router();

router.get('/:username', publicRateLimiter, getProfileByUsername);
router.patch('/me', authenticateJWT, updateMyProfileController);

export default router;
