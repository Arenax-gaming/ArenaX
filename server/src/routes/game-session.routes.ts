import { Router } from 'express';
import gameSessionController from '../controllers/game-session.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

// Public routes
router.get('/:id', gameSessionController.getSession.bind(gameSessionController));
router.get('/:id/replay', gameSessionController.getReplay.bind(gameSessionController));

// Protected routes
router.post('/', authenticateJWT, gameSessionController.createSession.bind(gameSessionController));
router.put('/:id/state', authenticateJWT, gameSessionController.updateState.bind(gameSessionController));
router.post('/:id/actions', authenticateJWT, gameSessionController.submitAction.bind(gameSessionController));
router.post('/:id/finish', authenticateJWT, gameSessionController.finishGame.bind(gameSessionController));

export default router;
