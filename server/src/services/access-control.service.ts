import { AuthenticatedUser } from '../types/auth.types';
import { hasPermission, getRolePermissions, Permission, roleDefinitions, RoleDefinition } from '../middleware/rbac.middleware';
import { logger } from './logger.service';

export interface AccessCheckResult {
    allowed: boolean;
    role: string;
    permissions: Permission[];
    missingPermissions?: Permission[];
}

export interface DelegationRecord {
    id: string;
    delegatorId: string;
    delegateeId: string;
    role: string;
    permissions: Permission[];
    expiresAt: number;
    maxUses: number;
    currentUses: number;
    createdAt: number;
}

export interface AuditLogEntry {
    id: string;
    actorId: string;
    action: string;
    targetId?: string;
    resource: string;
    details: string;
    timestamp: number;
    ipAddress?: string;
}

const auditLog: AuditLogEntry[] = [];
const delegations: Map<string, DelegationRecord> = new Map();
const MAX_AUDIT_LOG_SIZE = 10_000;

export class AccessControlService {
    checkAccess(user: AuthenticatedUser, permission: Permission): AccessCheckResult {
        const allowed = hasPermission(user.role, permission);
        const permissions = getRolePermissions(user.role);

        if (!allowed) {
            logger.warn('Access check failed', {
                userId: user.id,
                role: user.role,
                permission,
            });
        }

        return {
            allowed,
            role: user.role,
            permissions,
            missingPermissions: allowed ? undefined : [permission],
        };
    }

    checkMultiplePermissions(user: AuthenticatedUser, permissions: Permission[]): AccessCheckResult {
        const userPerms = getRolePermissions(user.role);
        const missing = permissions.filter((p) => !userPerms.includes(p));

        return {
            allowed: missing.length === 0,
            role: user.role,
            permissions: userPerms,
            missingPermissions: missing.length > 0 ? missing : undefined,
        };
    }

    logAuditEntry(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
        const logEntry: AuditLogEntry = {
            ...entry,
            id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
        };

        auditLog.push(logEntry);
        if (auditLog.length > MAX_AUDIT_LOG_SIZE) {
            auditLog.splice(0, auditLog.length - MAX_AUDIT_LOG_SIZE);
        }

        logger.info('Audit entry recorded', {
            id: logEntry.id,
            actor: logEntry.actorId,
            action: logEntry.action,
            resource: logEntry.resource,
        });
    }

    getAuditLog(filters?: { actorId?: string; action?: string; limit?: number }): AuditLogEntry[] {
        let entries = [...auditLog];
        if (filters?.actorId) {
            entries = entries.filter((e) => e.actorId === filters.actorId);
        }
        if (filters?.action) {
            entries = entries.filter((e) => e.action === filters.action);
        }
        entries.sort((a, b) => b.timestamp - a.timestamp);
        return entries.slice(0, filters?.limit ?? 100);
    }

    createDelegation(
        delegator: AuthenticatedUser,
        delegateeId: string,
        role: string,
        durationMs: number,
        maxUses: number = 0
    ): DelegationRecord | null {
        const delegatorPerms = getRolePermissions(delegator.role);
        const targetRolePerms = getRolePermissions(role);

        const hasAllPerms = targetRolePerms.every((p) => delegatorPerms.includes(p));
        if (!hasAllPerms) {
            logger.warn('Delegation denied: delegator lacks permissions', {
                delegatorId: delegator.id,
                targetRole: role,
            });
            return null;
        }

        const delegation: DelegationRecord = {
            id: `del-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            delegatorId: delegator.id,
            delegateeId,
            role,
            permissions: targetRolePerms,
            expiresAt: Date.now() + durationMs,
            maxUses,
            currentUses: 0,
            createdAt: Date.now(),
        };

        delegations.set(delegation.id, delegation);

        this.logAuditEntry({
            actorId: delegator.id,
            action: 'delegation.created',
            targetId: delegateeId,
            resource: 'access-control',
            details: `Delegated role ${role} to ${delegateeId}`,
        });

        return delegation;
    }

    revokeDelegation(delegationId: string, revokerId: string): boolean {
        const delegation = delegations.get(delegationId);
        if (!delegation) return false;

        delegations.delete(delegationId);

        this.logAuditEntry({
            actorId: revokerId,
            action: 'delegation.revoked',
            targetId: delegation.delegateeId,
            resource: 'access-control',
            details: `Revoked delegation ${delegationId}`,
        });

        return true;
    }

    useDelegation(delegationId: string): boolean {
        const delegation = delegations.get(delegationId);
        if (!delegation) return false;

        if (Date.now() > delegation.expiresAt) {
            delegations.delete(delegationId);
            return false;
        }

        if (delegation.maxUses > 0 && delegation.currentUses >= delegation.maxUses) {
            return false;
        }

        delegation.currentUses += 1;
        return true;
    }

    getActiveDelegations(userId: string): DelegationRecord[] {
        const now = Date.now();
        return Array.from(delegations.values()).filter(
            (d) => d.delegateeId === userId && d.expiresAt > now
        );
    }

    getRoleInfo(roleName: string): RoleDefinition | undefined {
        return roleDefinitions[roleName];
    }

    getAllRoles(): string[] {
        return Object.keys(roleDefinitions);
    }
}

export const defaultAccessControlService = new AccessControlService();
