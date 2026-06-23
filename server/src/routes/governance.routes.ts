import { Router } from 'express';
import { 
    createProposal, 
    startVoting, 
    voteOnProposal, 
    executeProposal, 
    getProposal, 
    listProposals 
} from '../controllers/governance.controller';
import { authenticateJWT, restrictTo } from '../middleware/auth.middleware';
import { adminRateLimiter, paymentRateLimiter } from '../middleware/rate-limit.middleware';

const router: Router = Router();

// Governance endpoints require authenticated admin by default
router.use(authenticateJWT, restrictTo('ADMIN'), adminRateLimiter);

// View proposals (logged in users)
router.get('/', adminRateLimiter, listProposals);
router.get('/:id', adminRateLimiter, getProposal);

// Govern/Admin only actions
router.post('/', restrictTo('ADMIN', 'GOVERNOR'), paymentRateLimiter, createProposal);
router.post('/:id/start-voting', restrictTo('ADMIN', 'GOVERNOR'), paymentRateLimiter, startVoting);
router.post('/:id/vote', restrictTo('ADMIN', 'GOVERNOR', 'SIGNER'), paymentRateLimiter, voteOnProposal);
router.post('/:id/execute', restrictTo('ADMIN', 'GOVERNOR'), paymentRateLimiter, executeProposal);

export default router;
