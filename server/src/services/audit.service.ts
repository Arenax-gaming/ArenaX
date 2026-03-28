import { getDatabaseClient } from './database.service';

export class AuditService {
    /**
     * Log an administrative action.
     */
    static async logAction(data: {
        adminId: string;
        action: string;
        targetType: string;
        targetId: string;
        details?: any;
        ipAddress?: string;
        userAgent?: string;
        requestId?: string;
        snapshotBefore?: any;
        snapshotAfter?: any;
    }) {
        const prisma = getDatabaseClient();
        return await prisma.auditLog.create({
            data: {
                adminId: data.adminId,
                action: data.action,
                targetType: data.targetType,
                targetId: data.targetId,
                details: data.details || {},
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                requestId: data.requestId,
                snapshotBefore: data.snapshotBefore || {},
                snapshotAfter: data.snapshotAfter || {},
            },
        });
    }

    /**
     * List audit logs with filters.
     */
    static async listLogs(filters: {
        adminId?: string;
        action?: string;
        targetType?: string;
        targetId?: string;
    } = {}) {
        const prisma = getDatabaseClient();
        return await prisma.auditLog.findMany({
            where: filters,
            include: {
                admin: {
                    select: { username: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
    }
}
