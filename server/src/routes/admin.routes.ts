import { Router } from 'express';
import { 
    getAdminStatus, 
    listDisputes, 
    resolveDispute, 
    listAuditLogs,
    replayPayment
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
import { authenticateJWT, restrictTo } from '../middleware/auth.middleware';
import { adminRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

router.use(adminRateLimiter, authenticateJWT, restrictTo('ADMIN'));

router.get('/status', getAdminStatus);
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
