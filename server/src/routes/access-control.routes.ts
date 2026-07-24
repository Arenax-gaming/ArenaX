import { Router, Request, Response } from 'express';
import { authenticateJWT, restrictToScope } from '../middleware/auth.middleware';
import { defaultAccessControlService } from '../services/access-control.service';
import { AuthenticatedUser } from '../types/auth.types';
import { Permission } from '../middleware/rbac.middleware';
import { HttpError } from '../utils/http-error';

const router: Router = Router();

router.use(authenticateJWT);

router.get(
    '/roles',
    restrictToScope('SYSTEM:READ'),
    (_req: Request, res: Response) => {
        const roles = defaultAccessControlService.getAllRoles();
        res.json({ roles });
    }
);

router.get(
    '/roles/:role',
    restrictToScope('SYSTEM:READ'),
    (req: Request, res: Response) => {
        const role = defaultAccessControlService.getRoleInfo(req.params.role);
        if (!role) {
            throw new HttpError(404, 'Role not found');
        }
        res.json(role);
    }
);

router.post(
    '/check',
    restrictToScope('SYSTEM:READ'),
    (req: Request, res: Response) => {
        const user = req.user as AuthenticatedUser;
        const { permission } = req.body as { permission: Permission };
        if (!permission) {
            throw new HttpError(400, 'permission is required');
        }
        const result = defaultAccessControlService.checkAccess(user, permission);
        res.json(result);
    }
);

router.post(
    '/check-multi',
    restrictToScope('SYSTEM:READ'),
    (req: Request, res: Response) => {
        const user = req.user as AuthenticatedUser;
        const { permissions } = req.body as { permissions: Permission[] };
        if (!permissions || !Array.isArray(permissions)) {
            throw new HttpError(400, 'permissions array is required');
        }
        const result = defaultAccessControlService.checkMultiplePermissions(user, permissions);
        res.json(result);
    }
);

router.post(
    '/delegation',
    restrictToScope('SYSTEM:WRITE'),
    (req: Request, res: Response) => {
        const user = req.user as AuthenticatedUser;
        const { delegateeId, role, durationMs, maxUses } = req.body;
        if (!delegateeId || !role || !durationMs) {
            throw new HttpError(400, 'delegateeId, role, and durationMs are required');
        }
        const delegation = defaultAccessControlService.createDelegation(
            user,
            delegateeId,
            role,
            durationMs,
            maxUses
        );
        if (!delegation) {
            throw new HttpError(403, 'Cannot delegate: insufficient permissions');
        }
        res.status(201).json(delegation);
    }
);

router.delete(
    '/delegation/:id',
    restrictToScope('SYSTEM:WRITE'),
    (req: Request, res: Response) => {
        const user = req.user as AuthenticatedUser;
        const revoked = defaultAccessControlService.revokeDelegation(req.params.id, user.id);
        if (!revoked) {
            throw new HttpError(404, 'Delegation not found');
        }
        res.status(204).send();
    }
);

router.get(
    '/delegation',
    restrictToScope('SYSTEM:READ'),
    (req: Request, res: Response) => {
        const user = req.user as AuthenticatedUser;
        const delegations = defaultAccessControlService.getActiveDelegations(user.id);
        res.json({ delegations });
    }
);

router.get(
    '/audit',
    restrictToScope('SYSTEM:READ'),
    (req: Request, res: Response) => {
        const { actorId, action, limit } = req.query;
        const entries = defaultAccessControlService.getAuditLog({
            actorId: actorId as string,
            action: action as string,
            limit: limit ? parseInt(limit as string, 10) : undefined,
        });
        res.json({ entries, count: entries.length });
    }
);

export default router;
