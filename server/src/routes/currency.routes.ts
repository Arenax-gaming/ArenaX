import { Router } from 'express';
import { listCurrencies, getRates, convertCurrency } from '../controllers/currency.controller';

const router: Router = Router();

// Supported currency catalogue (Issue #1263).
/**
 * @openapi
 * /v1/currencies:
 *   get:
 *     summary: Supported currency catalogue (Issue Issue 1263)
 *     tags: [Currency]
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
router.get('/', listCurrencies);

// Exchange rates for a base currency.
/**
 * @openapi
 * /v1/currencies/rates:
 *   get:
 *     summary: Exchange rates for a base currency
 *     tags: [Currency]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: base
 *         required: false
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
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/rates', getRates);

// Convert an amount between two currencies.
/**
 * @openapi
 * /v1/currencies/convert:
 *   get:
 *     summary: Convert an amount between two currencies
 *     tags: [Currency]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
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
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/convert', convertCurrency);

export default router;
