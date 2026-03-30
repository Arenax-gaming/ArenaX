import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
    createRecoveryChallenge,
    exportMyWallet,
    getLedger,
    getMyWallet,
    getTransactions,
    internalTransfer,
    lockEscrow,
    releaseEscrow,
    rotateWalletEncryption,
    slashEscrow
} from '../controllers/wallet.controller';
import { authenticateJWT, restrictTo } from '../middleware/auth.middleware';

const router = Router();

const walletRecoveryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 1000 : 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: {
            code: 'WALLET_RECOVERY_RATE_LIMIT',
            message: 'Too many wallet recovery attempts. Please try again later.'
        }
    }
});

router.use(authenticateJWT);

router.get('/me', getMyWallet);
router.post('/me/recovery/challenges', walletRecoveryLimiter, createRecoveryChallenge);
router.post('/me/recovery/export', walletRecoveryLimiter, exportMyWallet);
router.post('/me/rotate-encryption', rotateWalletEncryption);
router.post('/rotate-encryption', restrictTo('ADMIN'), rotateWalletEncryption);

router.get('/ledger', getLedger);
router.get('/transactions', getTransactions);
router.post('/escrow/lock', lockEscrow);
router.post('/escrow/release', releaseEscrow);
router.post('/escrow/slash', slashEscrow);
router.post('/transfer', internalTransfer);

export default router;
