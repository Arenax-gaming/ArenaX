import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { simulateContract, invokeContract, getTxStatus } from '../controllers/soroban.controller';

const router = Router();

// Simulate a contract call (no submission)
router.post('/simulate', authenticateJWT, simulateContract);

// Build, simulate, sign, submit, and monitor a contract call
router.post('/invoke', authenticateJWT, invokeContract);

// Poll the status of a submitted transaction
router.get('/tx/:txHash', authenticateJWT, getTxStatus);

export default router;
