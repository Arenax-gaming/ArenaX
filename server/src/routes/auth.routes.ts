import { Router } from 'express';
import { authRateLimiter, emailVerificationResendRateLimiter } from '../middleware/rate-limit.middleware';
import { authenticateJWT } from '../middleware/auth.middleware';
import * as authController from '../controllers/auth.controller';

const router: Router = Router();

router.post('/register', authRateLimiter, authController.register);
router.post('/login', authRateLimiter, authController.login);
router.post('/login/2fa', authRateLimiter, authController.login2FAHandler);
router.post('/refresh', authRateLimiter, authController.refresh);
router.post('/logout', authRateLimiter, authController.logout);
router.post('/social/:provider', authRateLimiter, authController.socialAuth);
router.post('/guest', authRateLimiter, authController.guestSession);
router.get('/verify-email', authRateLimiter, authController.verifyEmailHandler);
router.post('/verify-email', authRateLimiter, authController.verifyEmailHandler);
router.post('/resend-verification-email', emailVerificationResendRateLimiter, authController.resendVerificationEmailHandler);
router.post('/forgot-password', authRateLimiter, authController.forgotPasswordHandler);
router.post('/reset-password', authRateLimiter, authController.resetPasswordHandler);

// Two-factor authentication (TOTP) endpoints (#1431)
router.post('/me/2fa/enroll', authenticateJWT, authController.enroll2FAHandler);
router.post('/me/2fa/verify', authenticateJWT, authController.verify2FAHandler);
router.post('/2fa/enroll', authenticateJWT, authController.enroll2FAHandler);
router.post('/2fa/verify', authenticateJWT, authController.verify2FAHandler);

export default router;
