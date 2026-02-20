import { Decimal } from '@prisma/client/runtime/library';

export class PaystackService {
    private readonly secret = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || '';
    private readonly baseUrl = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';

    async verifyTransaction(reference: string) {
        if (!this.secret) throw new Error('PAYSTACK_SECRET_KEY missing');
        const res = await fetch(`${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${this.secret}`,
                Accept: 'application/json',
            },
        });
        if (!res.ok) throw new Error(`paystack verify failed ${res.status}`);
        const json: any = await res.json();
        const status = json?.data?.status;
        const amountKobo = json?.data?.amount;
        const amount = amountKobo != null ? new Decimal(amountKobo).div(100) : null;
        return {
            ok: status === 'success',
            raw: json,
            status,
            amount,
            currency: (json?.data?.currency as string | undefined) || 'NGN',
            reference: json?.data?.reference as string | undefined,
            customer: json?.data?.customer,
        };
    }
}

export default new PaystackService();
