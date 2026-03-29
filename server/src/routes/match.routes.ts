import { Router } from 'express';
import { reportScore, raiseDispute } from '../controllers/match.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateJWT);

router.post('/:id/report', reportScore);
router.post('/:id/dispute', raiseDispute);

export default router;
