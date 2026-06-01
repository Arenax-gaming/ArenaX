import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { simulateContract, invokeContract, getTxStatus } from '../controllers/soroban.controller';
import { paymentRateLimiter } from '../middleware/rate-limit.middleware';

const router: Router = Router();

// Simulate a contract call (no submission)
router.post('/simulate', authenticateJWT, paymentRateLimiter, simulateContract);

// Build, simulate, sign, submit, and monitor a contract call
router.post('/invoke', authenticateJWT, paymentRateLimiter, invokeContract);

// Poll the status of a submitted transaction
router.get('/tx/:txHash', authenticateJWT, paymentRateLimiter, getTxStatus);

export default router;
