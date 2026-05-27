import { Router } from 'express';
import {
    getAdminStatus,
    listDisputes,
    resolveDispute,
    listAuditLogs,
    replayPayment,
    listUsers,
    banUnbanUser,
    bulkUserOperation,
    getGameConfig,
    updateGameConfig,
    getModerationQueue,
    reviewContent,
    getSystemHealth
} from '../controllers/admin.controller';
import { confirmationService } from '../services/confirmation.service';
import {
    listKycReviews,
    getKycReview,
    processKycReview
} from '../controllers/kyc.controller';
import { 
    listRefundRequests, 
    updateRefundStatus, 
    createRefundRequest 
} from '../controllers/refund.controller';
import { authenticateJWT, restrictTo, restrictToScope } from '../middleware/auth.middleware';
import requireConfirmationForBulk from '../middleware/confirm.middleware';
import { adminRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

router.use(adminRateLimiter, authenticateJWT, restrictTo('ADMIN'));

router.get('/status', getAdminStatus);
// Request a confirmation token for destructive/bulk actions
router.post('/confirmations', authenticateJWT, restrictToScope('admin:write'), (req, res) => {
    const { action, payload, ttlMs } = req.body as any
    if (!action) return res.status(400).json({ error: 'action is required' })
    const info = confirmationService.generate(req.user!.id, action, payload, ttlMs)
    res.status(200).json({ token: info.token, expiresAt: info.expiresAt })
})
// User management
router.get('/users', listUsers);
router.post('/users/bulk', restrictToScope('USERS:WRITE'), requireConfirmationForBulk(10), bulkUserOperation);
router.post('/users/:id/ban', restrictToScope('USERS:WRITE'), banUnbanUser);

// Game configuration
router.get('/games/config', getGameConfig);
router.put('/games/config', restrictToScope('GAMES:WRITE'), updateGameConfig);

// Moderation
router.get('/moderation/queue', getModerationQueue);
router.post('/moderation/review', restrictToScope('MODERATION:REVIEW'), reviewContent);

// System
router.get('/system/health', getSystemHealth);
router.get('/disputes', listDisputes);
router.post('/disputes/:id/resolve', resolveDispute);
router.get('/audit-logs', listAuditLogs);
router.post('/payments/:id/replay', replayPayment);

// KYC Management
router.get('/kyc', listKycReviews);
router.get('/kyc/:id', getKycReview);
router.post('/kyc/:id/process', processKycReview);

// Refund Management
router.get('/refunds', listRefundRequests);
router.patch('/refunds/:id/status', updateRefundStatus);
router.post('/refunds', createRefundRequest);

export default router;
