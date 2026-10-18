import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { listAnchors, quoteAnchors, getAnchorCompliance } from '../controllers/anchor.controller';

const router: Router = Router();

// List every registered Stellar anchor (Issue #1262).
router.get('/', listAnchors);

// Rank anchors by effective rate for a corridor.
router.get('/quote', authenticateJWT, quoteAnchors);

// Verify a single anchor's compliance posture.
router.get('/:id/compliance', authenticateJWT, getAnchorCompliance);

export default router;
