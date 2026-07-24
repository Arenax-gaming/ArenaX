import { Request, Response, NextFunction } from 'express';
import { AuthenticatedUser } from '../types/auth.types';
import { HttpError } from '../utils/http-error';
import { logger } from '../services/logger.service';

export type Permission =
    | 'users:read'
    | 'users:write'
    | 'users:delete'
    | 'games:read'
    | 'games:write'
    | 'games:delete'
    | 'matches:read'
    | 'matches:write'
    | 'tournaments:read'
    | 'tournaments:write'
    | 'tournaments:admin'
    | 'analytics:read'
    | 'analytics:write'
    | 'analytics:admin'
    | 'staking:read'
    | 'staking:write'
    | 'staking:admin'
    | 'assets:read'
    | 'assets:write'
    | 'assets:bridge'
    | 'system:read'
    | 'system:write'
    | 'moderation:read'
    | 'moderation:write'
    | 'payments:read'
    | 'payments:write';

export interface RoleDefinition {
    name: string;
    permissions: Permission[];
    inheritsFrom?: string[];
}

const roleDefinitions: Record<string, RoleDefinition> = {
    USER: {
        name: 'USER',
        permissions: ['games:read', 'matches:read', 'tournaments:read'],
    },
    PLAYER: {
        name: 'PLAYER',
        permissions: ['games:read', 'matches:read', 'matches:write', 'tournaments:read', 'analytics:read'],
        inheritsFrom: ['USER'],
    },
    MODERATOR: {
        name: 'MODERATOR',
        permissions: ['moderation:read', 'moderation:write', 'users:read', 'games:read'],
        inheritsFrom: ['PLAYER'],
    },
    SUPPORT: {
        name: 'SUPPORT',
        permissions: ['users:read', 'moderation:read', 'analytics:read'],
        inheritsFrom: ['PLAYER'],
    },
    GAME_DEVELOPER: {
        name: 'GAME_DEVELOPER',
        permissions: ['games:read', 'games:write', 'matches:read', 'matches:write', 'analytics:read', 'analytics:write'],
        inheritsFrom: ['PLAYER'],
    },
    TOURNAMENT_ORGANIZER: {
        name: 'TOURNAMENT_ORGANIZER',
        permissions: ['tournaments:read', 'tournaments:write', 'tournaments:admin', 'analytics:read'],
        inheritsFrom: ['PLAYER'],
    },
    ANALYTICS_VIEWER: {
        name: 'ANALYTICS_VIEWER',
        permissions: ['analytics:read', 'analytics:admin'],
        inheritsFrom: ['PLAYER'],
    },
    STAKING_MANAGER: {
        name: 'STAKING_MANAGER',
        permissions: ['staking:read', 'staking:write', 'staking:admin'],
        inheritsFrom: ['PLAYER'],
    },
    CROSS_GAME_ADMIN: {
        name: 'CROSS_GAME_ADMIN',
        permissions: ['assets:read', 'assets:write', 'assets:bridge'],
        inheritsFrom: ['PLAYER'],
    },
    OPERATOR: {
        name: 'OPERATOR',
        permissions: [
            'users:read', 'users:write',
            'games:read', 'games:write',
            'matches:read', 'matches:write',
            'tournaments:read', 'tournaments:write', 'tournaments:admin',
            'analytics:read', 'analytics:write', 'analytics:admin',
            'staking:read', 'staking:write', 'staking:admin',
            'assets:read', 'assets:write', 'assets:bridge',
            'moderation:read', 'moderation:write',
            'payments:read', 'payments:write',
        ],
        inheritsFrom: ['PLAYER'],
    },
    ADMIN: {
        name: 'ADMIN',
        permissions: [
            'users:read', 'users:write', 'users:delete',
            'games:read', 'games:write', 'games:delete',
            'matches:read', 'matches:write',
            'tournaments:read', 'tournaments:write', 'tournaments:admin',
            'analytics:read', 'analytics:write', 'analytics:admin',
            'staking:read', 'staking:write', 'staking:admin',
            'assets:read', 'assets:write', 'assets:bridge',
            'system:read', 'system:write',
            'moderation:read', 'moderation:write',
            'payments:read', 'payments:write',
        ],
    },
};

function resolvePermissions(roleName: string, visited: Set<string> = new Set()): Permission[] {
    if (visited.has(roleName)) return [];
    visited.add(roleName);

    const role = roleDefinitions[roleName];
    if (!role) return [];

    let perms = [...role.permissions];
    if (role.inheritsFrom) {
        for (const parent of role.inheritsFrom) {
            perms = [...perms, ...resolvePermissions(parent, visited)];
        }
    }
    return [...new Set(perms)];
}

export const getRolePermissions = (roleName: string): Permission[] => {
    return resolvePermissions(roleName);
};

export const hasPermission = (roleName: string, permission: Permission): boolean => {
    const perms = getRolePermissions(roleName);
    return perms.includes(permission);
};

export const requirePermission = (permission: Permission) => {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const user = req.user as AuthenticatedUser | undefined;
        if (!user) {
            return next(new HttpError(401, 'Unauthorized'));
        }

        if (!hasPermission(user.role, permission)) {
            logger.warn('Permission denied', {
                userId: user.id,
                role: user.role,
                required: permission,
                path: req.originalUrl,
            });
            return next(new HttpError(403, `Missing permission: ${permission}`));
        }

        next();
    };
};

export const requireAnyPermission = (...permissions: Permission[]) => {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const user = req.user as AuthenticatedUser | undefined;
        if (!user) {
            return next(new HttpError(401, 'Unauthorized'));
        }

        const hasAny = permissions.some((p) => hasPermission(user.role, p));
        if (!hasAny) {
            logger.warn('Permission denied (any)', {
                userId: user.id,
                role: user.role,
                required: permissions,
                path: req.originalUrl,
            });
            return next(new HttpError(403, `Missing any of permissions: ${permissions.join(', ')}`));
        }

        next();
    };
};

export const requireAllPermissions = (...permissions: Permission[]) => {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const user = req.user as AuthenticatedUser | undefined;
        if (!user) {
            return next(new HttpError(401, 'Unauthorized'));
        }

        const hasAll = permissions.every((p) => hasPermission(user.role, p));
        if (!hasAll) {
            logger.warn('Permission denied (all)', {
                userId: user.id,
                role: user.role,
                required: permissions,
                path: req.originalUrl,
            });
            return next(new HttpError(403, `Missing all permissions: ${permissions.join(', ')}`));
        }

        next();
    };
};

export const requireRole = (...roles: string[]) => {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const user = req.user as AuthenticatedUser | undefined;
        if (!user) {
            return next(new HttpError(401, 'Unauthorized'));
        }

        if (!roles.includes(user.role)) {
            return next(new HttpError(403, `Required role: ${roles.join(' or ')}`));
        }

        next();
    };
};

export { roleDefinitions };
