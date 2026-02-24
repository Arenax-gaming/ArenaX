import { Router } from 'express';
import { getGovernanceStatus } from '../controllers/governance.controller';
import { authenticateJWT, restrictTo } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateJWT, restrictTo('ADMIN', 'GOVERNOR'));
router.get('/', getGovernanceStatus);

export default router;
