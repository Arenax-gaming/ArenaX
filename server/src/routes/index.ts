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
import analyticsRoutes from './analytics.routes';
import metricsRoutes from './metrics.routes';
import dashboardRoutes from './dashboard.routes';
import searchRoutes from './search.routes';
import queryAnalyticsRoutes from './query-analytics.routes';

import { publicRateLimiter } from '../middleware/rate-limit.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { maintenanceMiddleware } from '../middleware/maintenance.middleware';
import { MaintenanceService } from '../services/maintenance.service';

const router = Router();

router.use(publicRateLimiter);
router.use(auditMiddleware);

// Public maintenance status endpoint
router.get('/maintenance/status', (req, res) => {
    res.status(200).json(MaintenanceService.getInstance().getStatus());
});

router.use(maintenanceMiddleware);

router.use('/api/v1/auth', authRoutes);
router.use('/profiles', profileRoutes);
router.use('/matches', matchRoutes);
router.use('/api/v1/admin', adminRoutes);
router.use('/governance', governanceRoutes);
router.use('/soroban', sorobanRoutes);
router.use('/wallets', walletRoutes);
router.use('/wallet', walletRoutes);
router.use('/v1/achievements', achievementRoutes);
router.use('/v1/tournaments', tournamentRoutes);
router.use('/api/v1/analytics', analyticsRoutes);
router.use('/metrics', metricsRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/v1/search', searchRoutes);
router.use('/v1/query-analytics', queryAnalyticsRoutes);

export default router;
