import { Router } from 'express';
import { 
    getAdminStatus, 
    listDisputes, 
    resolveDispute, 
    listAuditLogs 
} from '../controllers/admin.controller';
import { authenticateJWT, restrictTo } from '../middleware/auth.middleware';
import { adminRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

router.use(adminRateLimiter, authenticateJWT, restrictTo('ADMIN'));

router.get('/status', getAdminStatus);
router.get('/disputes', listDisputes);
router.post('/disputes/:id/resolve', resolveDispute);
router.get('/audit-logs', listAuditLogs);

export default router;
