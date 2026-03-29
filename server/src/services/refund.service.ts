import { getDatabaseClient } from './database.service';
import { RefundStatus } from '.prisma/client';
import { AuditService } from './audit.service';

export class RefundService {
    /**
     * Create a new refund request.
     */
    async createRequest(data: {
        paymentId: string;
        amount: string;
        reason: string;
    }) {
        const prisma = getDatabaseClient();

        // Invariant check: refund amount <= payment amount
        const payment = await prisma.payment.findUnique({
            where: { id: data.paymentId }
        });

        if (!payment) {
            throw new Error('Payment not found.');
        }

        if (BigInt(data.amount) > BigInt(payment.amount)) {
            throw new Error('Refund amount exceeds original payment amount.');
        }

        return await prisma.refundRequest.create({
            data: {
                paymentId: data.paymentId,
                amount: data.amount,
                reason: data.reason,
                status: RefundStatus.REQUESTED
            }
        });
    }

    /**
     * Update the status of a refund request.
     */
    async updateStatus(
        id: string,
        operatorId: string,
        status: RefundStatus,
        notes?: string
    ) {
        const prisma = getDatabaseClient();

        const request = await prisma.refundRequest.findUnique({
            where: { id },
            include: { payment: true }
        });

        if (!request) {
            throw new Error('Refund request not found.');
        }

        // State machine validation
        this.validateTransition(request.status, status);

        const updatedRequest = await prisma.refundRequest.update({
            where: { id },
            data: {
                status,
                operatorId,
                operatorNotes: notes,
                updatedAt: new Date()
            }
        });

        // Trigger side effects
        if (status === RefundStatus.APPROVED) {
            await this.handleApproval(updatedRequest);
        }

        // Log action
        await AuditService.logAction({
            adminId: operatorId,
            action: `REFUND_${status}`,
            targetType: 'REFUND_REQUEST',
            targetId: id,
            details: { previousStatus: request.status, notes },
            ipAddress: 'internal' // Should be passed from controller
        });

        return updatedRequest;
    }

    private validateTransition(current: RefundStatus, next: RefundStatus) {
        const transitions: Record<RefundStatus, RefundStatus[]> = {
            [RefundStatus.REQUESTED]: [RefundStatus.REVIEWING, RefundStatus.REJECTED],
            [RefundStatus.REVIEWING]: [RefundStatus.APPROVED, RefundStatus.REJECTED],
            [RefundStatus.APPROVED]: [RefundStatus.PROCESSED],
            [RefundStatus.REJECTED]: [],
            [RefundStatus.PROCESSED]: []
        };

        if (!transitions[current].includes(next)) {
            throw new Error(`Invalid refund state transition from ${current} to ${next}.`);
        }
    }

    private async handleApproval(request: any) {
        // Here we would trigger the actual blockchain refund flow.
        // For now, we simulate success and move to PROCESSED.
        console.info(`Processing approved refund for request ${request.id}...`);
        
        const prisma = getDatabaseClient();
        await prisma.refundRequest.update({
            where: { id: request.id },
            data: { status: RefundStatus.PROCESSED, updatedAt: new Date() }
        });

        // Also update payment status if necessary
        await prisma.payment.update({
            where: { id: request.paymentId },
            data: { status: 'REFUNDED', updatedAt: new Date() }
        });
    }

    async listRequests(filters: any = {}) {
        const prisma = getDatabaseClient();
        return await prisma.refundRequest.findMany({
            where: filters,
            include: {
                payment: true,
                operator: { select: { username: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
    }
}

export default new RefundService();
