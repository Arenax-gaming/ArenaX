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
import { authenticateJWT, requireEmailVerified, restrictTo } from '../middleware/auth.middleware';
import { paymentRateLimiter, publicRateLimiter } from '../middleware/rate-limit.middleware';

const router: Router = Router();

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

// Browsing / read-only endpoints (accessible to unverified users to browse)
router.get('/me', publicRateLimiter, getMyWallet);
router.get('/ledger', publicRateLimiter, getLedger);
router.get('/transactions', publicRateLimiter, getTransactions);

// Wallet operations (blocked for unverified users)
router.post('/me/recovery/challenges', requireEmailVerified, walletRecoveryLimiter, createRecoveryChallenge);
router.post('/me/recovery/export', requireEmailVerified, walletRecoveryLimiter, exportMyWallet);
router.post('/me/rotate-encryption', requireEmailVerified, paymentRateLimiter, rotateWalletEncryption);
router.post('/rotate-encryption', restrictTo('ADMIN'), paymentRateLimiter, rotateWalletEncryption);

router.post('/escrow/lock', requireEmailVerified, paymentRateLimiter, lockEscrow);
router.post('/escrow/release', requireEmailVerified, paymentRateLimiter, releaseEscrow);
router.post('/escrow/slash', requireEmailVerified, paymentRateLimiter, slashEscrow);
router.post('/transfer', requireEmailVerified, paymentRateLimiter, internalTransfer);

export default router;
