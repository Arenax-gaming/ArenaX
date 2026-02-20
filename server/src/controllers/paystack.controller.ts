import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { WalletService } from '../services/wallet.service';

const walletService = new WalletService();

export const paystackWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const secret = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || '';
        if (!secret) return res.status(500).send('misconfigured');
        const signature = (req.headers['x-paystack-signature'] as string) || '';
        const rawBody: Buffer = (req as any).body;
        const computed = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
        if (signature !== computed) return res.status(401).send('invalid signature');
        const payload = JSON.parse(rawBody.toString('utf8'));
        if (payload?.event === 'charge.success') {
            const data = payload?.data;
            const userId = data?.metadata?.userId as string | undefined;
            if (userId) {
                const amount = new Decimal(data.amount).div(100);
                await walletService.addBalance(userId, 'NGN' as any, amount, data.reference, { source: 'paystack_webhook' });
            }
        }
        res.json({ received: true });
    } catch (e) {
        next(e);
    }
};
