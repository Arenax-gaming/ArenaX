import { Router } from 'express';
import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';
import governanceRoutes from './governance.routes';
import profileRoutes from './profile.routes';
import matchRoutes from './match.routes';

import { publicRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

router.use(publicRateLimiter);
router.use('/auth', authRoutes);
router.use('/profiles', profileRoutes);
router.use('/matches', matchRoutes); // Added
router.use('/admin', adminRoutes);
router.use('/governance', governanceRoutes);

export default router;
