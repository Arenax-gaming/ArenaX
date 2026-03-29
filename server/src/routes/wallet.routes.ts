import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
    getLedger,
    getTransactions,
    lockEscrow,
    releaseEscrow,
    slashEscrow,
    internalTransfer,
} from '../controllers/wallet.controller';

const router = Router();

router.get('/ledger',       authenticateJWT, getLedger);
router.get('/transactions', authenticateJWT, getTransactions);
router.post('/escrow/lock',    authenticateJWT, lockEscrow);
router.post('/escrow/release', authenticateJWT, releaseEscrow);
router.post('/escrow/slash',   authenticateJWT, slashEscrow);
router.post('/transfer',       authenticateJWT, internalTransfer);

export default router;
