import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { simulateContract, invokeContract, getTxStatus } from '../controllers/soroban.controller';
import { paymentRateLimiter } from '../middleware/rate-limit.middleware';

const router: Router = Router();

// Simulate a contract call (no submission)
/**
 * @openapi
 * /v1/soroban/simulate:
 *   post:
 *     summary: Simulate a contract call (no submission)
 *     tags: [Soroban]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contractId:
 *                 type: string
 *               functionName:
 *                 type: string
 *               args:
 *                 type: string
 *               sponsored:
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
 *       '429':
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RateLimitError'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/simulate', authenticateJWT, paymentRateLimiter, simulateContract);

// Build, simulate, sign, submit, and monitor a contract call
/**
 * @openapi
 * /v1/soroban/invoke:
 *   post:
 *     summary: Build, simulate, sign, submit, and monitor a contract call
 *     tags: [Soroban]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contractId:
 *                 type: string
 *               functionName:
 *                 type: string
 *               args:
 *                 type: string
 *               sponsored:
 *                 type: string
 *               type:
 *                 type: string
 *     responses:
 *       '202':
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
 *       '429':
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RateLimitError'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/invoke', authenticateJWT, paymentRateLimiter, invokeContract);

// Poll the status of a submitted transaction
/**
 * @openapi
 * /v1/soroban/tx/{txHash}:
 *   get:
 *     summary: Poll the status of a submitted transaction
 *     tags: [Soroban]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: txHash
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
 *       '429':
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RateLimitError'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/tx/:txHash', authenticateJWT, paymentRateLimiter, getTxStatus);

export default router;
