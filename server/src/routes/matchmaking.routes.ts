import { Router } from 'express';
import * as matchmakingController from '../controllers/matchmaking.controller';
import { publicRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

// Apply rate limiting to all matchmaking routes
router.use(publicRateLimiter);

// Queue management
router.post('/queue', matchmakingController.joinQueue);
router.delete('/queue', matchmakingController.leaveQueue);

// Queue status
router.get('/status', matchmakingController.getQueueStatus);

// Match invitation handling
router.post('/accept', matchmakingController.acceptMatch);
router.post('/decline', matchmakingController.declineMatch);

// Match history
router.get('/history', matchmakingController.getMatchHistory);

// Statistics (can be public for now)
router.get('/stats', matchmakingController.getMatchmakingStats);

export default router;