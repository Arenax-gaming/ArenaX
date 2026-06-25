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
    getSystemHealth,
    scheduleMaintenance,
    enableMaintenanceImmediately,
    disableMaintenance,
    getMaintenanceStatus
} from '../controllers/admin.controller';
import {
    searchAuditLogs,
    exportAuditLogs,
    verifyAuditIntegrity,
    replayAuditEvents,
    auditComplianceReport,
    redactUserAuditData,
    anchorAuditLogs,
} from '../controllers/audit.controller';
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

const router: Router = Router();

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

// ── Audit Trail ──────────────────────────────────────────────────────────────
router.get('/audit-logs', listAuditLogs);               // backward-compat
router.get('/audit/search', searchAuditLogs);           // advanced search
router.get('/audit/export', exportAuditLogs);           // CSV / JSON export
router.get('/audit/verify', verifyAuditIntegrity);      // chain integrity check
router.get('/audit/replay', replayAuditEvents);         // event replay
router.get('/audit/compliance-report', auditComplianceReport);
router.post('/audit/anchor', anchorAuditLogs);          // blockchain anchoring
router.post('/audit/redact/:userId', redactUserAuditData); // GDPR right-to-forget

router.post('/payments/:id/replay', replayPayment);

// KYC Management
router.get('/kyc', listKycReviews);
router.get('/kyc/:id', getKycReview);
router.post('/kyc/:id/process', processKycReview);

// Refund Management
router.get('/refunds', listRefundRequests);
router.patch('/refunds/:id/status', updateRefundStatus);
router.post('/refunds', createRefundRequest);

// Maintenance Management
router.post('/maintenance/schedule', restrictToScope('SYSTEM:WRITE'), scheduleMaintenance);
router.post('/maintenance/enable', restrictToScope('SYSTEM:WRITE'), enableMaintenanceImmediately);
router.post('/maintenance/disable', restrictToScope('SYSTEM:WRITE'), disableMaintenance);
router.get('/maintenance/status', getMaintenanceStatus);

export default router;
