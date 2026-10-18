import { Router } from 'express';
import { listCurrencies, getRates, convertCurrency } from '../controllers/currency.controller';

const router: Router = Router();

// Supported currency catalogue (Issue #1263).
router.get('/', listCurrencies);

// Exchange rates for a base currency.
router.get('/rates', getRates);

// Convert an amount between two currencies.
router.get('/convert', convertCurrency);

export default router;
