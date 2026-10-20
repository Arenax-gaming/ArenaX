import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { listAnchors, quoteAnchors, getAnchorCompliance } from '../controllers/anchor.controller';

const router: Router = Router();

// List every registered Stellar anchor (Issue #1262).
/**
 * @openapi
 * /v1/anchors:
 *   get:
 *     summary: List every registered Stellar anchor (Issue Issue 1262)
 *     tags: [Anchor]
 *     security: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', listAnchors);

// Rank anchors by effective rate for a corridor.
/**
 * @openapi
 * /v1/anchors/quote:
 *   get:
 *     summary: Rank anchors by effective rate for a corridor
 *     tags: [Anchor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: currency
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: direction
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: amount
 *         required: false
 *         schema:
 *           type: number
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
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/quote', authenticateJWT, quoteAnchors);

// Verify a single anchor's compliance posture.
/**
 * @openapi
 * /v1/anchors/{id}/compliance:
 *   get:
 *     summary: Verify a single anchor's compliance posture
 *     tags: [Anchor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
router.get('/:id/compliance', authenticateJWT, getAnchorCompliance);

export default router;
