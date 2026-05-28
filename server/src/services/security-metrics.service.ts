import { getDatabaseClient } from './database.service';

/**
 * Security Metrics and KPI Tracking Service
 * Tracks security-related metrics and key performance indicators
 */

export interface SecurityMetrics {
    timestamp: Date;
    authentication: {
        totalAttempts: number;
        successfulAttempts: number;
        failedAttempts: number;
        successRate: number;
        uniqueUsers: number;
        avgAttemptsPerUser: number;
    };
    authorization: {
        totalRequests: number;
        authorizedRequests: number;
        unauthorizedRequests: number;
        authorizationRate: number;
        adminActions: number;
    };
    rateLimiting: {
        totalBlocked: number;
        blockedByAuth: number;
        blockedByPayment: number;
        blockedByAdmin: number;
        blockedByPublic: number;
    };
    incidents: {
        totalIncidents: number;
        openIncidents: number;
        resolvedIncidents: number;
        criticalIncidents: number;
        highIncidents: number;
        mediumIncidents: number;
        lowIncidents: number;
        avgResolutionTimeMs: number;
    };
    sessionSecurity: {
        activeSessions: number;
        refreshTokensIssued: number;
        refreshTokensRevoked: number;
        tokenRotationSuccess: number;
        tokenRotationFailures: number;
    };
    performance: {
        avgResponseTimeMs: number;
        p95ResponseTimeMs: number;
        p99ResponseTimeMs: number;
        errorRate: number;
    };
}

// Store metrics history (in production, use time-series database)
const metricsHistory: SecurityMetrics[] = [];
const MAX_HISTORY_SIZE = 1000; // Keep last 1000 data points

/**
 * Collect current security metrics
 */
export const collectSecurityMetrics = async (): Promise<SecurityMetrics> => {
    const prisma = getDatabaseClient();
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Authentication metrics
    const auditLogs = await prisma.auditLog.findMany({
        where: {
            createdAt: {
                gte: oneHourAgo
            }
        }
    });
    
    const authLogs = auditLogs.filter(log => 
        log.action.includes('LOGIN') || log.action.includes('AUTH')
    );
    const successfulAuth = authLogs.filter(log => !log.action.includes('FAILED'));
    const failedAuth = authLogs.filter(log => log.action.includes('FAILED'));
    
    const uniqueAuthUsers = new Set(authLogs.map(log => log.adminId)).size;
    
    // Authorization metrics
    const totalRequests = auditLogs.length;
    const unauthorizedRequests = auditLogs.filter(log => 
        log.action.includes('UNAUTHORIZED') || log.action.includes('FORBIDDEN')
    ).length;
    const adminActions = auditLogs.filter(log => 
        log.action.includes('ADMIN') || log.action.includes('MODERATION')
    ).length;
    
    // Session metrics
    const activeRefreshTokens = await prisma.refreshToken.count({
        where: {
            revokedAt: null,
            expiresAt: {
                gte: now
            }
        }
    });
    
    const revokedTokens = await prisma.refreshToken.count({
        where: {
            revokedAt: {
                gte: oneHourAgo
            }
        }
    });
    
    const metrics: SecurityMetrics = {
        timestamp: now,
        authentication: {
            totalAttempts: authLogs.length,
            successfulAttempts: successfulAuth.length,
            failedAttempts: failedAuth.length,
            successRate: authLogs.length > 0 ? successfulAuth.length / authLogs.length : 1,
            uniqueUsers: uniqueAuthUsers,
            avgAttemptsPerUser: uniqueAuthUsers > 0 ? authLogs.length / uniqueAuthUsers : 0
        },
        authorization: {
            totalRequests,
            authorizedRequests: totalRequests - unauthorizedRequests,
            unauthorizedRequests,
            authorizationRate: totalRequests > 0 ? (totalRequests - unauthorizedRequests) / totalRequests : 1,
            adminActions
        },
        rateLimiting: {
            totalBlocked: 0, // Would be tracked by rate-limit middleware
            blockedByAuth: 0,
            blockedByPayment: 0,
            blockedByAdmin: 0,
            blockedByPublic: 0
        },
        incidents: {
            totalIncidents: 0, // Would be from security-incident service
            openIncidents: 0,
            resolvedIncidents: 0,
            criticalIncidents: 0,
            highIncidents: 0,
            mediumIncidents: 0,
            lowIncidents: 0,
            avgResolutionTimeMs: 0
        },
        sessionSecurity: {
            activeSessions: activeRefreshTokens,
            refreshTokensIssued: 0, // Would be tracked in auth service
            refreshTokensRevoked: revokedTokens,
            tokenRotationSuccess: 0,
            tokenRotationFailures: 0
        },
        performance: {
            avgResponseTimeMs: 0, // Would be tracked by performance middleware
            p95ResponseTimeMs: 0,
            p99ResponseTimeMs: 0,
            errorRate: 0
        }
    };
    
    // Store in history
    metricsHistory.push(metrics);
    if (metricsHistory.length > MAX_HISTORY_SIZE) {
        metricsHistory.shift();
    }
    
    return metrics;
};

/**
 * Get metrics history for a time range
 */
export const getMetricsHistory = (hours: number = 24): SecurityMetrics[] => {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return metricsHistory.filter(m => m.timestamp >= cutoff);
};

/**
 * Calculate KPIs from metrics
 */
export const calculateSecurityKPIs = (metrics: SecurityMetrics[]): {
    avgAuthSuccessRate: number;
    avgAuthSuccessRateTarget: number;
    avgAuthSuccessRateStatus: 'good' | 'warning' | 'critical';
    avgUnauthorizedRate: number;
    avgUnauthorizedRateTarget: number;
    avgUnauthorizedRateStatus: 'good' | 'warning' | 'critical';
    incidentResolutionRate: number;
    incidentResolutionRateTarget: number;
    incidentResolutionRateStatus: 'good' | 'warning' | 'critical';
    securityScore: number;
} => {
    if (metrics.length === 0) {
        return {
            avgAuthSuccessRate: 1,
            avgAuthSuccessRateTarget: 0.95,
            avgAuthSuccessRateStatus: 'good',
            avgUnauthorizedRate: 0,
            avgUnauthorizedRateTarget: 0.05,
            avgUnauthorizedRateStatus: 'good',
            incidentResolutionRate: 1,
            incidentResolutionRateTarget: 0.8,
            incidentResolutionRateStatus: 'good',
            securityScore: 100
        };
    }
    
    const avgAuthSuccessRate = metrics.reduce((sum, m) => sum + m.authentication.successRate, 0) / metrics.length;
    const avgUnauthorizedRate = metrics.reduce((sum, m) => sum + (m.authorization.unauthorizedRequests / Math.max(m.authorization.totalRequests, 1)), 0) / metrics.length;
    const incidentResolutionRate = metrics.reduce((sum, m) => {
        const total = m.incidents.totalIncidents;
        const resolved = m.incidents.resolvedIncidents;
        return sum + (total > 0 ? resolved / total : 1);
    }, 0) / metrics.length;
    
    // Determine status based on thresholds
    const avgAuthSuccessRateStatus = avgAuthSuccessRate >= 0.95 ? 'good' : avgAuthSuccessRate >= 0.85 ? 'warning' : 'critical';
    const avgUnauthorizedRateStatus = avgUnauthorizedRate <= 0.05 ? 'good' : avgUnauthorizedRate <= 0.15 ? 'warning' : 'critical';
    const incidentResolutionRateStatus = incidentResolutionRate >= 0.8 ? 'good' : incidentResolutionRate >= 0.5 ? 'warning' : 'critical';
    
    // Calculate overall security score (0-100)
    const authScore = avgAuthSuccessRate * 30;
    const unauthorizedScore = (1 - avgUnauthorizedRate) * 30;
    const incidentScore = incidentResolutionRate * 40;
    const securityScore = Math.min(100, Math.max(0, authScore + unauthorizedScore + incidentScore));
    
    return {
        avgAuthSuccessRate,
        avgAuthSuccessRateTarget: 0.95,
        avgAuthSuccessRateStatus,
        avgUnauthorizedRate,
        avgUnauthorizedRateTarget: 0.05,
        avgUnauthorizedRateStatus,
        incidentResolutionRate,
        incidentResolutionRateTarget: 0.8,
        incidentResolutionRateStatus,
        securityScore
    };
};

/**
 * Start metrics collection interval
 */
export const startMetricsCollection = (intervalMs: number = 5 * 60 * 1000): void => {
    setInterval(async () => {
        try {
            const metrics = await collectSecurityMetrics();
            console.log('[Security Metrics] Collected:', {
                timestamp: metrics.timestamp,
                authSuccessRate: metrics.authentication.successRate,
                unauthorizedRate: metrics.authorization.unauthorizedRequests / Math.max(metrics.authorization.totalRequests, 1),
                activeSessions: metrics.sessionSecurity.activeSessions
            });
        } catch (error) {
            console.error('[Security Metrics] Failed to collect metrics:', error);
        }
    }, intervalMs);
};
