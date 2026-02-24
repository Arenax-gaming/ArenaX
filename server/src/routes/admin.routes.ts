import { Router } from 'express';
import { getAdminStatus } from '../controllers/admin.controller';
import { authenticateJWT, restrictTo } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateJWT, restrictTo('ADMIN'));
router.get('/', getAdminStatus);

export default router;
