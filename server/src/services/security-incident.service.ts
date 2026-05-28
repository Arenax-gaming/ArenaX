import { HttpError } from '../utils/http-error';

/**
 * Security Incident Response Service
 * Handles security incident detection, reporting, and response workflow
 */

export enum IncidentSeverity {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL'
}

export enum IncidentType {
    BRUTE_FORCE = 'BRUTE_FORCE',
    SQL_INJECTION_ATTEMPT = 'SQL_INJECTION_ATTEMPT',
    XSS_ATTEMPT = 'XSS_ATTEMPT',
    CSRF_ATTEMPT = 'CSRF_ATTEMPT',
    UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
    PRIVILEGE_ESCALATION = 'PRIVILEGE_ESCALATION',
    DATA_EXFILTRATION = 'DATA_EXFILTRATION',
    DDOS_ATTACK = 'DDOS_ATTACK',
    MALICIOUS_PAYLOAD = 'MALICIOUS_PAYLOAD',
    ACCOUNT_TAKEOVER = 'ACCOUNT_TAKEOVER',
    ANOMALOUS_BEHAVIOR = 'ANOMALOUS_BEHAVIOR'
}

export enum IncidentStatus {
    OPEN = 'OPEN',
    INVESTIGATING = 'INVESTIGATING',
    CONTAINED = 'CONTAINED',
    RESOLVED = 'RESOLVED',
    CLOSED = 'CLOSED'
}

export interface SecurityIncident {
    id: string;
    type: IncidentType;
    severity: IncidentSeverity;
    status: IncidentStatus;
    description: string;
    sourceIp: string;
    userId?: string;
    metadata: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
    resolvedAt?: Date;
    resolvedBy?: string;
    resolution?: string;
}

// Store incidents in memory (in production, use database)
const incidents = new Map<string, SecurityIncident>();

/**
 * Create a new security incident
 */
export const createIncident = (
    type: IncidentType,
    severity: IncidentSeverity,
    description: string,
    sourceIp: string,
    userId?: string,
    metadata: Record<string, any> = {}
): SecurityIncident => {
    const incident: SecurityIncident = {
        id: `inc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type,
        severity,
        status: IncidentStatus.OPEN,
        description,
        sourceIp,
        userId,
        metadata,
        createdAt: new Date(),
        updatedAt: new Date()
    };
    
    incidents.set(incident.id, incident);
    
    // Log the incident
    console.error(`[Security Incident] ${severity}: ${type} - ${description}`, {
        incidentId: incident.id,
        sourceIp,
        userId,
        metadata
    });
    
    // Trigger alert for high/critical incidents
    if (severity === IncidentSeverity.HIGH || severity === IncidentSeverity.CRITICAL) {
        triggerSecurityAlert(incident);
    }
    
    return incident;
};

/**
 * Get incident by ID
 */
export const getIncident = (id: string): SecurityIncident | undefined => {
    return incidents.get(id);
};

/**
 * Get all incidents with optional filters
 */
export const getIncidents = (filters: {
    type?: IncidentType;
    severity?: IncidentSeverity;
    status?: IncidentStatus;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
} = {}): SecurityIncident[] => {
    let filtered = Array.from(incidents.values());
    
    if (filters.type) {
        filtered = filtered.filter(inc => inc.type === filters.type);
    }
    
    if (filters.severity) {
        filtered = filtered.filter(inc => inc.severity === filters.severity);
    }
    
    if (filters.status) {
        filtered = filtered.filter(inc => inc.status === filters.status);
    }
    
    if (filters.userId) {
        filtered = filtered.filter(inc => inc.userId === filters.userId);
    }
    
    if (filters.startDate) {
        filtered = filtered.filter(inc => inc.createdAt >= filters.startDate!);
    }
    
    if (filters.endDate) {
        filtered = filtered.filter(inc => inc.createdAt <= filters.endDate!);
    }
    
    // Return sorted by creation date (newest first)
    return filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
};

/**
 * Update incident status
 */
export const updateIncidentStatus = (
    id: string,
    status: IncidentStatus,
    resolvedBy?: string,
    resolution?: string
): SecurityIncident => {
    const incident = incidents.get(id);
    
    if (!incident) {
        throw new HttpError(404, 'Incident not found');
    }
    
    incident.status = status;
    incident.updatedAt = new Date();
    
    if (status === IncidentStatus.RESOLVED || status === IncidentStatus.CLOSED) {
        incident.resolvedAt = new Date();
        incident.resolvedBy = resolvedBy;
        incident.resolution = resolution;
    }
    
    console.log(`[Security Incident] Status updated: ${id} -> ${status}`);
    
    return incident;
};

/**
 * Trigger security alert for high/critical incidents
 */
const triggerSecurityAlert = (incident: SecurityIncident): void => {
    const webhookUrl = process.env.SECURITY_WEBHOOK_URL;
    
    if (!webhookUrl) {
        console.warn('[Security] No security webhook configured');
        return;
    }
    
    // In production, send alert to security team
    console.log(`[Security Alert] ${incident.severity} incident detected:`, {
        incidentId: incident.id,
        type: incident.type,
        description: incident.description,
        sourceIp: incident.sourceIp,
        userId: incident.userId
    });
};

/**
 * Get incident statistics
 */
export const getIncidentStats = (timeRange?: { startDate: Date; endDate: Date }) => {
    let allIncidents = Array.from(incidents.values());
    
    if (timeRange) {
        allIncidents = allIncidents.filter(
            inc => inc.createdAt >= timeRange.startDate && inc.createdAt <= timeRange.endDate
        );
    }
    
    const stats = {
        total: allIncidents.length,
        bySeverity: {
            [IncidentSeverity.LOW]: 0,
            [IncidentSeverity.MEDIUM]: 0,
            [IncidentSeverity.HIGH]: 0,
            [IncidentSeverity.CRITICAL]: 0
        },
        byType: {} as Record<IncidentType, number>,
        byStatus: {
            [IncidentStatus.OPEN]: 0,
            [IncidentStatus.INVESTIGATING]: 0,
            [IncidentStatus.CONTAINED]: 0,
            [IncidentStatus.RESOLVED]: 0,
            [IncidentStatus.CLOSED]: 0
        },
        openIncidents: 0,
        resolvedIncidents: 0,
        avgResolutionTimeMs: 0
    };
    
    let totalResolutionTime = 0;
    let resolvedCount = 0;
    
    for (const incident of allIncidents) {
        stats.bySeverity[incident.severity]++;
        stats.byType[incident.type] = (stats.byType[incident.type] || 0) + 1;
        stats.byStatus[incident.status]++;
        
        if (incident.status === IncidentStatus.OPEN) {
            stats.openIncidents++;
        }
        
        if (incident.status === IncidentStatus.RESOLVED || incident.status === IncidentStatus.CLOSED) {
            stats.resolvedIncidents++;
            if (incident.resolvedAt) {
                totalResolutionTime += incident.resolvedAt.getTime() - incident.createdAt.getTime();
                resolvedCount++;
            }
        }
    }
    
    if (resolvedCount > 0) {
        stats.avgResolutionTimeMs = totalResolutionTime / resolvedCount;
    }
    
    return stats;
};
