import express from 'express';
import { paystackWebhook } from '../controllers/paystack.controller';

const router = express.Router();

router.post('/paystack', express.raw({ type: 'application/json' }), paystackWebhook);

export default router;
