import { Router } from 'express';
import authRoutes from './auth.routes';
import webhookRoutes from './webhooks.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/webhooks', webhookRoutes);

// Placeholder for other routes
// router.use('/projects', projectRoutes);
// router.use('/payments', paymentRoutes);
// router.use('/wallets', walletRoutes);

export default router;
