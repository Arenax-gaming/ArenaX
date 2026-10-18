import { Request, Response, NextFunction } from 'express';
import {
    anchorService,
    ANCHOR_CURRENCIES,
    AnchorCurrency,
    AnchorTransferDirection,
} from '../services/anchor.service';
import { HttpError } from '../utils/http-error';

const isCurrency = (value: unknown): value is AnchorCurrency =>
    typeof value === 'string' && (ANCHOR_CURRENCIES as readonly string[]).includes(value);

const isDirection = (value: unknown): value is AnchorTransferDirection =>
    value === 'deposit' || value === 'withdrawal';

/** GET /api/v1/anchors — every registered anchor. */
export const listAnchors = (_req: Request, res: Response, next: NextFunction) => {
    try {
        res.json({ data: anchorService.listAnchors() });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/v1/anchors/quote?currency=USD&direction=deposit&amount=100
 * Returns anchors ranked by effective rate for the requested corridor.
 */
export const quoteAnchors = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { currency, direction, amount } = req.query;
        if (!isCurrency(currency)) {
            throw new HttpError(400, 'currency must be a supported ISO-4217 code');
        }
        if (!isDirection(direction)) {
            throw new HttpError(400, 'direction must be "deposit" or "withdrawal"');
        }
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            throw new HttpError(400, 'amount must be a positive number');
        }

        const ranked = await anchorService.rankAnchors({
            currency,
            direction,
            amount: numericAmount,
        });

        res.json({
            data: ranked.map((entry) => ({
                anchor: {
                    id: entry.anchor.id,
                    name: entry.anchor.name,
                    homeDomain: entry.anchor.homeDomain,
                },
                quote: entry.quote,
                netAmount: entry.netAmount,
                effectiveRate: entry.effectiveRate,
            })),
        });
    } catch (err) {
        next(err);
    }
};

/** GET /api/v1/anchors/:id/compliance — compliance posture for one anchor. */
export const getAnchorCompliance = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const anchor = anchorService.getAnchor(id);
        if (!anchor) {
            throw new HttpError(404, 'Anchor not found');
        }
        const result = await anchorService.verifyCompliance(id);
        res.json({ data: result });
    } catch (err) {
        next(err);
    }
};
