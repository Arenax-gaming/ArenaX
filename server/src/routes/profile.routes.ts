import { Router } from 'express';
import {
    getProfileByUsername,
    updateMyProfileController
} from '../controllers/profile.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.get('/:username', getProfileByUsername);
router.patch('/me', authenticateJWT, updateMyProfileController);

export default router;
