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
import cacheRoutes from './cache.routes';
import apiGatewayRoutes from './api-gateway.routes';
import queueRoutes from './queue.routes';
import accessControlRoutes from './access-control.routes';
import crossGameAssetRoutes from './cross-game-asset.routes';
import i18nRoutes from './i18n.routes';


import { publicRateLimiter } from '../middleware/rate-limit.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { maintenanceMiddleware } from '../middleware/maintenance.middleware';
import { MaintenanceService } from '../services/maintenance.service';
import { apiVersionRegistry } from '../config/api-versions';

const router: Router = Router();

router.use(publicRateLimiter);
router.use(auditMiddleware);

// Public maintenance status endpoint
router.get('/maintenance/status', (req, res) => {
    res.status(200).json(MaintenanceService.getInstance().getStatus());
});

router.get('/versions', (req, res) => {
    res.status(200).json({
        current: apiVersionRegistry.getDefault().name,
        versions: apiVersionRegistry.list(),
    });
});

router.use(maintenanceMiddleware);

// This router is mounted at `/api` in app.ts, so a canonical v1 route only
// needs a `/v1/...` prefix here — mounting `/api/v1/...` under it produced
// unreachable `/api/api/v1/...` paths (see #657). Routes that previously
// had that double prefix, or none at all, are given a single `/v1/...`
// mount here. `mountVersioned` additionally keeps the pre-versioning
// unversioned path alive as a deprecated alias for clients/tests that
// haven't migrated yet, so both `/api/v1/<resource>` and `/api/<resource>`
// keep working during the transition.
const mountVersioned = (base: string, handler: Router) => {
    router.use(`/v1${base}`, handler);
    router.use(base, handler);
};

mountVersioned('/auth', authRoutes);
mountVersioned('/profiles', profileRoutes);
mountVersioned('/matches', matchRoutes);
mountVersioned('/admin', adminRoutes);
mountVersioned('/governance', governanceRoutes);
mountVersioned('/soroban', sorobanRoutes);
mountVersioned('/wallets', walletRoutes);
mountVersioned('/wallet', walletRoutes);
mountVersioned('/analytics', analyticsRoutes);
router.use('/v1/achievements', achievementRoutes);
router.use('/v1/tournaments', tournamentRoutes);
router.use('/v1/search', searchRoutes);
router.use('/v1/cache', cacheRoutes);
router.use('/v1/gateway', apiGatewayRoutes);
router.use('/v1/queue', queueRoutes);
router.use('/v1/access-control', accessControlRoutes);
router.use('/v1/assets', crossGameAssetRoutes);
router.use('/v1/i18n', i18nRoutes);

// Unversioned infrastructure endpoints — not part of the public API surface.
router.use('/metrics', metricsRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
