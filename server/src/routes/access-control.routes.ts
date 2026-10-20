import { Router, Request, Response } from 'express';
import { authenticateJWT, restrictToScope } from '../middleware/auth.middleware';
import { defaultAccessControlService } from '../services/access-control.service';
import { AuthenticatedUser } from '../types/auth.types';
import { Permission } from '../middleware/rbac.middleware';
import { HttpError } from '../utils/http-error';

const router: Router = Router();

router.use(authenticateJWT);

/**
 * @openapi
 * /v1/access-control/roles:
 *   get:
 *     summary: Get access control roles
 *     tags: [AccessControl]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
    '/roles',
    restrictToScope('SYSTEM:READ'),
    (_req: Request, res: Response) => {
        const roles = defaultAccessControlService.getAllRoles();
        res.json({ roles });
    }
);

/**
 * @openapi
 * /v1/access-control/roles/{role}:
 *   get:
 *     summary: Get access control roles
 *     tags: [AccessControl]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: role
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Resource not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /v1/access-control/check:
 *   post:
 *     summary: Create access control check
 *     tags: [AccessControl]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               permission:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /v1/access-control/check-multi:
 *   post:
 *     summary: Create access control check multi
 *     tags: [AccessControl]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               permissions:
 *                 type: array
 *                 items: {}
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /v1/access-control/delegation:
 *   post:
 *     summary: Create access control delegation
 *     tags: [AccessControl]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               delegateeId:
 *                 type: string
 *               role:
 *                 type: string
 *               durationMs:
 *                 type: string
 *               maxUses:
 *                 type: string
 *     responses:
 *       '201':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /v1/access-control/delegation/{id}:
 *   delete:
 *     summary: Delete access control delegation
 *     tags: [AccessControl]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '204':
 *         description: Successful response
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Resource not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /v1/access-control/delegation:
 *   get:
 *     summary: Get access control delegation
 *     tags: [AccessControl]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
    '/delegation',
    restrictToScope('SYSTEM:READ'),
    (req: Request, res: Response) => {
        const user = req.user as AuthenticatedUser;
        const delegations = defaultAccessControlService.getActiveDelegations(user.id);
        res.json({ delegations });
    }
);

/**
 * @openapi
 * /v1/access-control/audit:
 *   get:
 *     summary: Get access control audit
 *     tags: [AccessControl]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: actorId
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: action
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
