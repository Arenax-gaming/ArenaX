import { Router } from 'express';
import { authRateLimiter } from '../middleware/rate-limit.middleware';
import * as authController from '../controllers/auth.controller';

const router = Router();

router.post('/register', authRateLimiter, authController.register);
router.post('/login', authRateLimiter, authController.login);
router.post('/refresh', authRateLimiter, authController.refresh);
router.post('/logout', authRateLimiter, authController.logout);

export default router;
