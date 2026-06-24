import { Router } from 'express';
import {
    listFlags,
    getFlag,
    createFlag,
    updateFlag,
    deleteFlag,
    getAuditLogs,
    evaluateFlag
} from '../controllers/feature-flag.controller';
import { authenticateJWT, restrictTo } from '../middleware/auth.middleware';

const router: Router = Router();

// Flag evaluation can be requested by authenticated users
router.post('/:key/evaluate', authenticateJWT, evaluateFlag);

// Admin-only management endpoints
router.use(authenticateJWT, restrictTo('ADMIN'));

router.get('/', listFlags);
router.post('/', createFlag);
router.get('/:key', getFlag);
router.put('/:key', updateFlag);
router.delete('/:key', deleteFlag);
router.get('/:key/audit', getAuditLogs);

export default router;
