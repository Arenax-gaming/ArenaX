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
import { authenticateJWT, optionalAuthenticateJWT, restrictTo } from '../middleware/auth.middleware';

const router: Router = Router();

// Flag evaluation can be requested for client-side evaluation or authenticated users
router.get('/:flagKey/evaluate', optionalAuthenticateJWT, evaluateFlag);
router.get('/:key/evaluate', optionalAuthenticateJWT, evaluateFlag);
router.post('/:flagKey/evaluate', optionalAuthenticateJWT, evaluateFlag);
router.post('/:key/evaluate', optionalAuthenticateJWT, evaluateFlag);

// Admin-only management endpoints
router.use(authenticateJWT, restrictTo('ADMIN'));

router.get('/', listFlags);
router.post('/', createFlag);
router.get('/:key', getFlag);
router.put('/:key', updateFlag);
router.delete('/:key', deleteFlag);
router.get('/:key/audit', getAuditLogs);

export default router;
