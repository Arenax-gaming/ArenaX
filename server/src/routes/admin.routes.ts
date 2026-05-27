import { Router } from 'express';
import { 
    getAdminStatus, 
    listDisputes, 
    resolveDispute, 
    listAuditLogs,
    replayPayment
} from '../controllers/admin.controller';
import {
    listUsers,
    banUnbanUser,
    bulkUserOperation,
    getGameConfig,
    updateGameConfig,
    getModerationQueue,
    reviewContent,
    getSystemHealth
} from '../controllers/admin.controller';
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
import { adminRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

router.use(adminRateLimiter, authenticateJWT, restrictTo('ADMIN'));

router.get('/status', getAdminStatus);
// User management
router.get('/users', listUsers);
router.post('/users/bulk', restrictToScope('USERS:WRITE'), bulkUserOperation);
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
