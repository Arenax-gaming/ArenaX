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

const router = Router();

router.use(authenticateJWT);

// View proposals (logged in users)
router.get('/', listProposals);
router.get('/:id', getProposal);

// Govern/Admin only actions
router.post('/', restrictTo('ADMIN', 'GOVERNOR'), createProposal);
router.post('/:id/start-voting', restrictTo('ADMIN', 'GOVERNOR'), startVoting);
router.post('/:id/vote', restrictTo('ADMIN', 'GOVERNOR', 'SIGNER'), voteOnProposal);
router.post('/:id/execute', restrictTo('ADMIN', 'GOVERNOR'), executeProposal);

export default router;
