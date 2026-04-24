import { Router } from 'express';
import tournamentController from '../controllers/tournament.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

// Public routes
router.get('/', tournamentController.listTournaments.bind(tournamentController));
router.get('/:id', tournamentController.getTournament.bind(tournamentController));
router.get('/:id/bracket', tournamentController.getBracket.bind(tournamentController));
router.get('/:id/standings', tournamentController.getStandings.bind(tournamentController));

// Protected routes (require authentication)
router.post('/', authenticateJWT, tournamentController.createTournament.bind(tournamentController));
router.post('/:id/register', authenticateJWT, tournamentController.registerPlayer.bind(tournamentController));
router.post('/:id/check-in', authenticateJWT, tournamentController.checkIn.bind(tournamentController));
router.post('/:id/report-result', authenticateJWT, tournamentController.reportResult.bind(tournamentController));

export default router;
