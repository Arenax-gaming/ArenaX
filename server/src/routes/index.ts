import { Router } from 'express';
import authRoutes from './auth.routes';

const router = Router();

router.use('/auth', authRoutes);

// Placeholder for other routes
// router.use('/projects', projectRoutes);
// router.use('/payments', paymentRoutes);
// router.use('/wallets', walletRoutes);

export default router;
