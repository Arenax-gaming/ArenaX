import { Request, Response, NextFunction } from 'express';
import { currencyService, CurrencyCode } from '../services/currency.service';
import { HttpError } from '../utils/http-error';

const isCurrencyCode = (value: unknown): value is CurrencyCode =>
    typeof value === 'string' && currencyService.isSupported(value);

/** GET /api/v1/currencies — catalogue of supported currencies. */
export const listCurrencies = (_req: Request, res: Response, next: NextFunction) => {
    try {
        res.json({ data: currencyService.getSupportedCurrencies() });
    } catch (err) {
        next(err);
    }
};

/** GET /api/v1/currencies/rates?base=NGN — exchange rates for a base currency. */
export const getRates = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const base = (req.query.base as string) || 'NGN';
        if (!isCurrencyCode(base)) {
            throw new HttpError(400, 'base must be a supported currency code');
        }
        const rates = await currencyService.getRates(base);
        res.json({ data: rates });
    } catch (err) {
        next(err);
    }
};

/** GET /api/v1/currencies/convert?from=NGN&to=USD&amount=1000 */
export const convertCurrency = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { from, to, amount } = req.query;
        if (!isCurrencyCode(from) || !isCurrencyCode(to)) {
            throw new HttpError(400, 'from and to must be supported currency codes');
        }
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount < 0) {
            throw new HttpError(400, 'amount must be a non-negative number');
        }
        const result = await currencyService.convert(from, to, numericAmount);
        res.json({
            data: {
                ...result,
                formatted: currencyService.format(result.converted, to),
            },
        });
    } catch (err) {
        next(err);
    }
};
