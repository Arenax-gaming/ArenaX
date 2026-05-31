import { Router } from 'express';
import tournamentController from '../controllers/tournament.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { publicRateLimiter, paymentRateLimiter } from '../middleware/rate-limit.middleware';

const router: Router = Router();

// Public routes
router.get('/', publicRateLimiter, tournamentController.listTournaments.bind(tournamentController));
router.get('/:id', publicRateLimiter, tournamentController.getTournament.bind(tournamentController));
router.get('/:id/bracket', publicRateLimiter, tournamentController.getBracket.bind(tournamentController));
router.get('/:id/standings', publicRateLimiter, tournamentController.getStandings.bind(tournamentController));

// Protected routes (require authentication)
router.post('/', authenticateJWT, paymentRateLimiter, tournamentController.createTournament.bind(tournamentController));
router.post('/:id/register', authenticateJWT, paymentRateLimiter, tournamentController.registerPlayer.bind(tournamentController));
router.post('/:id/check-in', authenticateJWT, paymentRateLimiter, tournamentController.checkIn.bind(tournamentController));
router.post('/:id/report-result', authenticateJWT, paymentRateLimiter, tournamentController.reportResult.bind(tournamentController));

export default router;
