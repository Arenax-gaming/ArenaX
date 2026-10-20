import { Router, Request, Response } from 'express';
import { authenticateJWT, restrictToScope } from '../middleware/auth.middleware';
import { defaultCrossGameAssetService } from '../services/cross-game-asset.service';
import { AuthenticatedUser } from '../types/auth.types';
import { HttpError } from '../utils/http-error';

const router: Router = Router();

router.use(authenticateJWT);

/**
 * @openapi
 * /v1/assets/assets:
 *   get:
 *     summary: Get assets assets
 *     tags: [CrossGameAsset]
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
    '/assets',
    restrictToScope('GAMES:READ'),
    (_req: Request, res: Response) => {
        const assets = defaultCrossGameAssetService.getAllAssets();
        res.json({ assets, count: assets.length });
    }
);

/**
 * @openapi
 * /v1/assets/assets/{assetId}:
 *   get:
 *     summary: Get assets assets
 *     tags: [CrossGameAsset]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: assetId
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
    '/assets/:assetId',
    restrictToScope('GAMES:READ'),
    (req: Request, res: Response) => {
        const asset = defaultCrossGameAssetService.getAsset(req.params.assetId);
        if (!asset) {
            throw new HttpError(404, 'Asset not found');
        }
        res.json(asset);
    }
);

/**
 * @openapi
 * /v1/assets/assets:
 *   post:
 *     summary: Create assets assets
 *     tags: [CrossGameAsset]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               assetId:
 *                 type: string
 *               kind:
 *                 type: string
 *               rarity:
 *                 type: string
 *               name:
 *                 type: string
 *               compatibleGames:
 *                 type: string
 *               maxSupply:
 *                 type: string
 *               isTransferable:
 *                 type: boolean
 *               isTradeable:
 *                 type: boolean
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
    '/assets',
    restrictToScope('GAMES:WRITE'),
    (req: Request, res: Response) => {
        const { assetId, kind, rarity, name, compatibleGames, maxSupply, isTransferable, isTradeable } = req.body;
        if (!assetId || !kind || !name) {
            throw new HttpError(400, 'assetId, kind, and name are required');
        }
        defaultCrossGameAssetService.registerAsset({
            assetId,
            kind,
            rarity: rarity || 'common',
            name,
            compatibleGames: compatibleGames || [],
            maxSupply: maxSupply || 0,
            currentSupply: 0,
            isTransferable: isTransferable !== false,
            isTradeable: isTradeable !== false,
            createdAt: Date.now(),
        });
        res.status(201).json({ message: 'Asset registered', assetId });
    }
);

/**
 * @openapi
 * /v1/assets/mint:
 *   post:
 *     summary: Create assets mint
 *     tags: [CrossGameAsset]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               assetId:
 *                 type: string
 *               to:
 *                 type: string
 *                 format: date-time
 *               amount:
 *                 type: number
 *               sourceGameId:
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
    '/mint',
    restrictToScope('GAMES:WRITE'),
    (req: Request, res: Response) => {
        const { assetId, to, amount, sourceGameId } = req.body;
        if (!assetId || !to || !amount || !sourceGameId) {
            throw new HttpError(400, 'assetId, to, amount, and sourceGameId are required');
        }
        const balance = defaultCrossGameAssetService.mintAsset(assetId, to, amount, sourceGameId);
        if (!balance) {
            throw new HttpError(400, 'Minting failed: asset not found, supply exceeded, or game incompatible');
        }
        res.status(201).json(balance);
    }
);

/**
 * @openapi
 * /v1/assets/transfer:
 *   post:
 *     summary: Create assets transfer
 *     tags: [CrossGameAsset]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               from:
 *                 type: string
 *                 format: date-time
 *               to:
 *                 type: string
 *                 format: date-time
 *               assetId:
 *                 type: string
 *               amount:
 *                 type: number
 *               fromGameId:
 *                 type: string
 *               toGameId:
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
    '/transfer',
    restrictToScope('GAMES:WRITE'),
    (req: Request, res: Response) => {
        const { from, to, assetId, amount, fromGameId, toGameId } = req.body;
        if (!from || !to || !assetId || !amount || fromGameId === undefined || toGameId === undefined) {
            throw new HttpError(400, 'All fields are required');
        }
        const success = defaultCrossGameAssetService.transferAsset(
            from, to, assetId, amount, fromGameId, toGameId
        );
        if (!success) {
            throw new HttpError(400, 'Transfer failed: insufficient balance, asset not transferable, or game incompatible');
        }
        res.json({ message: 'Transfer successful' });
    }
);

/**
 * @openapi
 * /v1/assets/inventory/{player}:
 *   get:
 *     summary: Get assets inventory
 *     tags: [CrossGameAsset]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: player
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
    '/inventory/:player',
    restrictToScope('GAMES:READ'),
    (req: Request, res: Response) => {
        const inventory = defaultCrossGameAssetService.getPlayerInventory(req.params.player);
        res.json({ inventory, count: inventory.length });
    }
);

/**
 * @openapi
 * /v1/assets/chains:
 *   get:
 *     summary: Get assets chains
 *     tags: [CrossGameAsset]
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
    '/chains',
    restrictToScope('GAMES:READ'),
    (_req: Request, res: Response) => {
        const chains = defaultCrossGameAssetService.getSupportedChains();
        res.json({ chains });
    }
);

/**
 * @openapi
 * /v1/assets/chains:
 *   post:
 *     summary: Create assets chains
 *     tags: [CrossGameAsset]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               chainId:
 *                 type: string
 *               chainName:
 *                 type: string
 *               bridgeContract:
 *                 type: string
 *               maxBridgeAmount:
 *                 type: number
 *               bridgeFeeBps:
 *                 type: string
 *               cooldownSecs:
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
    '/chains',
    restrictToScope('SYSTEM:WRITE'),
    (req: Request, res: Response) => {
        const { chainId, chainName, bridgeContract, maxBridgeAmount, bridgeFeeBps, cooldownSecs } = req.body;
        if (!chainId || !chainName || !bridgeContract) {
            throw new HttpError(400, 'chainId, chainName, and bridgeContract are required');
        }
        defaultCrossGameAssetService.registerChain({
            chainId,
            chainName,
            bridgeContract,
            isActive: true,
            maxBridgeAmount: maxBridgeAmount || 0,
            bridgeFeeBps: bridgeFeeBps || 0,
            cooldownSecs: cooldownSecs || 300,
        });
        res.status(201).json({ message: 'Chain registered', chainId });
    }
);

/**
 * @openapi
 * /v1/assets/bridge:
 *   post:
 *     summary: Create assets bridge
 *     tags: [CrossGameAsset]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               assetId:
 *                 type: string
 *               amount:
 *                 type: number
 *               targetChain:
 *                 type: string
 *               sourceGameId:
 *                 type: string
 *               targetGameId:
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
    '/bridge',
    restrictToScope('ASSETS:BRIDGE'),
    (req: Request, res: Response) => {
        const user = req.user as AuthenticatedUser;
        const { assetId, amount, targetChain, sourceGameId, targetGameId } = req.body;
        if (!assetId || !amount || !targetChain || !sourceGameId || !targetGameId) {
            throw new HttpError(400, 'All fields are required');
        }
        const request = defaultCrossGameAssetService.initiateBridge(
            user.id, assetId, amount, targetChain, sourceGameId, targetGameId
        );
        if (!request) {
            throw new HttpError(400, 'Bridge initiation failed: asset not found, chain inactive, or insufficient balance');
        }
        res.status(201).json(request);
    }
);

/**
 * @openapi
 * /v1/assets/bridge/{requestId}/complete:
 *   post:
 *     summary: Create bridge complete
 *     tags: [CrossGameAsset]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
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
router.post(
    '/bridge/:requestId/complete',
    restrictToScope('SYSTEM:WRITE'),
    (req: Request, res: Response) => {
        const success = defaultCrossGameAssetService.completeBridge(req.params.requestId);
        if (!success) {
            throw new HttpError(400, 'Bridge completion failed');
        }
        res.json({ message: 'Bridge completed' });
    }
);

/**
 * @openapi
 * /v1/assets/bridge/{requestId}/fail:
 *   post:
 *     summary: Create bridge fail
 *     tags: [CrossGameAsset]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
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
router.post(
    '/bridge/:requestId/fail',
    restrictToScope('SYSTEM:WRITE'),
    (req: Request, res: Response) => {
        const success = defaultCrossGameAssetService.failBridge(req.params.requestId);
        if (!success) {
            throw new HttpError(400, 'Bridge failure processing failed');
        }
        res.json({ message: 'Bridge failed and assets refunded' });
    }
);

/**
 * @openapi
 * /v1/assets/bridge/{requestId}/cancel:
 *   post:
 *     summary: Create bridge cancel
 *     tags: [CrossGameAsset]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
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
router.post(
    '/bridge/:requestId/cancel',
    restrictToScope('ASSETS:BRIDGE'),
    (req: Request, res: Response) => {
        const user = req.user as AuthenticatedUser;
        const success = defaultCrossGameAssetService.cancelBridge(req.params.requestId, user.id);
        if (!success) {
            throw new HttpError(400, 'Bridge cancellation failed');
        }
        res.json({ message: 'Bridge cancelled and assets refunded' });
    }
);

/**
 * @openapi
 * /v1/assets/analytics:
 *   get:
 *     summary: Get assets analytics
 *     tags: [CrossGameAsset]
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
    '/analytics',
    restrictToScope('ANALYTICS:READ'),
    (_req: Request, res: Response) => {
        const analytics = defaultCrossGameAssetService.getAnalytics();
        res.json(analytics);
    }
);

export default router;
