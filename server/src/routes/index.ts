import { Router } from 'express';
import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';
import governanceRoutes from './governance.routes';
import profileRoutes from './profile.routes';
import sorobanRoutes from './soroban.routes';
import walletRoutes from './wallet.routes';
import matchRoutes from './match.routes';
import achievementRoutes from './achievement.routes';
import tournamentRoutes from './tournament.routes';

import { publicRateLimiter } from '../middleware/rate-limit.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';

const router = Router();

router.use(publicRateLimiter);
router.use(auditMiddleware);
router.use('/auth', authRoutes);
router.use('/profiles', profileRoutes);
router.use('/matches', matchRoutes);
router.use('/admin', adminRoutes);
router.use('/governance', governanceRoutes);
router.use('/soroban', sorobanRoutes);
router.use('/wallets', walletRoutes);
router.use('/wallet', walletRoutes);
router.use('/v1/achievements', achievementRoutes);
router.use('/v1/tournaments', tournamentRoutes);

export default router;
