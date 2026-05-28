import { getDatabaseClient } from './database.service';
import { AuditService } from './audit.service';
import { IncidentSeverity } from './security-incident.service';

/**
 * Security Audit Report Service
 * Generates regular security audit reports for compliance and monitoring
 */

export interface SecurityAuditReport {
    id: string;
    generatedAt: Date;
    period: {
        startDate: Date;
        endDate: Date;
    };
    summary: {
        totalUsers: number;
        activeUsers: number;
        totalAuthAttempts: number;
        failedAuthAttempts: number;
        successfulAuthAttempts: number;
        totalIncidents: number;
        criticalIncidents: number;
        highIncidents: number;
        mediumIncidents: number;
        lowIncidents: number;
    };
    authentication: {
        uniqueLogins: number;
        avgLoginAttemptsPerUser: number;
        topFailedLoginIps: Array<{ ip: string; attempts: number }>;
        accountsLocked: number;
    };
    authorization: {
        adminActions: number;
        privilegeEscalationAttempts: number;
        unauthorizedAccessAttempts: number;
    };
    dataAccess: {
        sensitiveDataAccess: number;
        dataExportAttempts: number;
        bulkDataAccess: number;
    };
    recommendations: string[];
}

/**
 * Generate security audit report for a time period
 */
export const generateSecurityAuditReport = async (
    startDate: Date,
    endDate: Date
): Promise<SecurityAuditReport> => {
    const prisma = getDatabaseClient();
    
    // Get user statistics
    const totalUsers = await prisma.user.count();
    const activeUsers = await prisma.user.count({
        where: {
            updatedAt: {
                gte: startDate
            }
        }
    });
    
    // Get audit logs for the period
    const auditLogs = await prisma.auditLog.findMany({
        where: {
            createdAt: {
                gte: startDate,
                lte: endDate
            }
        },
        orderBy: {
            createdAt: 'asc'
        }
    });
    
    // Analyze authentication events
    const authAttempts = auditLogs.filter(log => 
        log.action.includes('LOGIN') || log.action.includes('AUTH')
    );
    const failedAuthAttempts = authAttempts.filter(log => 
        log.action.includes('FAILED') || (typeof log.details === 'object' && log.details !== null && 'error' in log.details)
    ).length;
    const successfulAuthAttempts = authAttempts.length - failedAuthAttempts;
    
    // Analyze admin actions
    const adminActions = auditLogs.filter(log => 
        log.action.includes('ADMIN') || log.action.includes('MODERATION')
    ).length;
    
    // Analyze data access patterns
    const sensitiveDataAccess = auditLogs.filter(log => 
        log.targetType === 'USER' || log.targetType === 'WALLET'
    ).length;
    
    // Get incident statistics (from security-incident service)
    // Note: Incident stats would be retrieved from the security-incident service
    // For now, using placeholder values
    const incidentStats = {
        total: 0,
        bySeverity: {
            [IncidentSeverity.LOW]: 0,
            [IncidentSeverity.MEDIUM]: 0,
            [IncidentSeverity.HIGH]: 0,
            [IncidentSeverity.CRITICAL]: 0
        },
        byType: {} as Record<string, number>,
        byStatus: {
            OPEN: 0,
            INVESTIGATING: 0,
            CONTAINED: 0,
            RESOLVED: 0,
            CLOSED: 0
        },
        openIncidents: 0,
        resolvedIncidents: 0,
        avgResolutionTimeMs: 0
    };
    
    // Generate recommendations based on findings
    const recommendations: string[] = [];
    
    if (failedAuthAttempts / Math.max(authAttempts.length, 1) > 0.1) {
        recommendations.push('High rate of failed authentication attempts detected. Consider implementing additional rate limiting or MFA.');
    }
    
    if (incidentStats.openIncidents > 0) {
        recommendations.push(`${incidentStats.openIncidents} open security incidents require attention.`);
    }
    
    if (incidentStats.bySeverity[IncidentSeverity.CRITICAL] > 0) {
        recommendations.push('Critical security incidents detected. Immediate investigation required.');
    }
    
    if (adminActions > 100) {
        recommendations.push('High volume of admin actions detected. Review for potential abuse.');
    }
    
    const report: SecurityAuditReport = {
        id: `audit-${Date.now()}`,
        generatedAt: new Date(),
        period: { startDate, endDate },
        summary: {
            totalUsers,
            activeUsers,
            totalAuthAttempts: authAttempts.length,
            failedAuthAttempts,
            successfulAuthAttempts,
            totalIncidents: incidentStats.total,
            criticalIncidents: incidentStats.bySeverity[IncidentSeverity.CRITICAL],
            highIncidents: incidentStats.bySeverity[IncidentSeverity.HIGH],
            mediumIncidents: incidentStats.bySeverity[IncidentSeverity.MEDIUM],
            lowIncidents: incidentStats.bySeverity[IncidentSeverity.LOW]
        },
        authentication: {
            uniqueLogins: new Set(auditLogs.filter(log => log.action === 'LOGIN_SUCCESS').map(log => log.adminId)).size,
            avgLoginAttemptsPerUser: authAttempts.length / Math.max(activeUsers, 1),
            topFailedLoginIps: [], // Would need to parse from audit logs
            accountsLocked: 0 // Would need to track from account-lockout service
        },
        authorization: {
            adminActions,
            privilegeEscalationAttempts: 0, // Would need to track specifically
            unauthorizedAccessAttempts: auditLogs.filter(log => log.action.includes('UNAUTHORIZED')).length
        },
        dataAccess: {
            sensitiveDataAccess,
            dataExportAttempts: auditLogs.filter(log => log.action.includes('EXPORT')).length,
            bulkDataAccess: auditLogs.filter(log => log.action.includes('BULK')).length
        },
        recommendations
    };
    
    return report;
};

/**
 * Schedule regular audit reports (daily, weekly, monthly)
 */
export const scheduleAuditReports = (): void => {
    // Daily audit report
    setInterval(async () => {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
        
        try {
            const report = await generateSecurityAuditReport(startDate, endDate);
            console.log('[Security Audit] Daily report generated:', report.id);
            
            // In production, send report to security team
        } catch (error) {
            console.error('[Security Audit] Failed to generate daily report:', error);
        }
    }, 24 * 60 * 60 * 1000);
    
    // Weekly audit report
    setInterval(async () => {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        try {
            const report = await generateSecurityAuditReport(startDate, endDate);
            console.log('[Security Audit] Weekly report generated:', report.id);
            
            // In production, send report to security team
        } catch (error) {
            console.error('[Security Audit] Failed to generate weekly report:', error);
        }
    }, 7 * 24 * 60 * 60 * 1000);
    
    // Monthly audit report
    setInterval(async () => {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        try {
            const report = await generateSecurityAuditReport(startDate, endDate);
            console.log('[Security Audit] Monthly report generated:', report.id);
            
            // In production, send report to security team
        } catch (error) {
            console.error('[Security Audit] Failed to generate monthly report:', error);
        }
    }, 30 * 24 * 60 * 60 * 1000);
};
