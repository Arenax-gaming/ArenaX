/**
 * Multi-currency support beyond NGN (Issue #1263).
 *
 * ArenaX historically priced everything in NGN. This service provides the
 * currency catalogue, an injectable exchange-rate provider, conversion and
 * formatting helpers, and per-currency payment-gateway routing so wagers,
 * wallets and payouts can be denominated in the player's chosen currency.
 */

import { logger } from './logger.service';

export type CurrencyCode = 'NGN' | 'USD' | 'EUR' | 'GBP' | 'GHS' | 'KES' | 'ZAR';

export interface CurrencyInfo {
    code: CurrencyCode;
    symbol: string;
    name: string;
    /** Minor-unit exponent (e.g. 2 for cents). */
    decimals: number;
    /** BCP-47 locales used to pick the display format. */
    locales: string[];
    /** Payment gateway ids that can settle this currency. */
    gateways: string[];
    /** Whether the currency is enabled for wagers. */
    enabled: boolean;
}

export interface ExchangeRate {
    base: CurrencyCode;
    /** Currency code -> units of that currency per 1 unit of `base`. */
    rates: Record<string, number>;
    /** When the rate snapshot was produced. */
    asOf: string;
}

export interface CurrencyConversion {
    from: CurrencyCode;
    to: CurrencyCode;
    amount: number;
    converted: number;
    rate: number;
}

export interface MultiCurrencyTransaction {
    id: string;
    playerId: string;
    amount: number;
    currency: CurrencyCode;
    /** Amount expressed in the platform's base currency (NGN). */
    baseAmount: number;
    baseCurrency: CurrencyCode;
    type: 'wager' | 'deposit' | 'withdrawal' | 'payout' | 'refund';
    gateway?: string;
    createdAt: string;
}

/** Base currency every amount is normalised to for accounting. */
export const BASE_CURRENCY: CurrencyCode = 'NGN';

export const CURRENCY_CATALOGUE: Record<CurrencyCode, CurrencyInfo> = {
    NGN: {
        code: 'NGN',
        symbol: '₦',
        name: 'Nigerian Naira',
        decimals: 2,
        locales: ['en-NG'],
        gateways: ['paystack', 'flutterwave'],
        enabled: true,
    },
    USD: {
        code: 'USD',
        symbol: '$',
        name: 'US Dollar',
        decimals: 2,
        locales: ['en-US'],
        gateways: ['stripe', 'paypal'],
        enabled: true,
    },
    EUR: {
        code: 'EUR',
        symbol: '€',
        name: 'Euro',
        decimals: 2,
        locales: ['en-IE', 'de-DE', 'fr-FR'],
        gateways: ['stripe'],
        enabled: true,
    },
    GBP: {
        code: 'GBP',
        symbol: '£',
        name: 'British Pound',
        decimals: 2,
        locales: ['en-GB'],
        gateways: ['stripe'],
        enabled: true,
    },
    GHS: {
        code: 'GHS',
        symbol: '₵',
        name: 'Ghanaian Cedi',
        decimals: 2,
        locales: ['en-GH'],
        gateways: ['flutterwave'],
        enabled: true,
    },
    KES: {
        code: 'KES',
        symbol: 'KSh',
        name: 'Kenyan Shilling',
        decimals: 2,
        locales: ['en-KE'],
        gateways: ['flutterwave'],
        enabled: true,
    },
    ZAR: {
        code: 'ZAR',
        symbol: 'R',
        name: 'South African Rand',
        decimals: 2,
        locales: ['en-ZA'],
        gateways: ['flutterwave'],
        enabled: true,
    },
};

/**
 * Supplies exchange rates. Implementations may call an FX API; the default
 * provider returns a static snapshot so conversions are deterministic offline.
 */
export interface ExchangeRateProvider {
    getRates(base: CurrencyCode): Promise<ExchangeRate>;
}

/** Units of each currency per 1 USD, used to derive cross rates. */
const STATIC_USD_RATES: Record<CurrencyCode, number> = {
    NGN: 1550,
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    GHS: 12.6,
    KES: 129,
    ZAR: 18.4,
};

export class StaticExchangeRateProvider implements ExchangeRateProvider {
    private readonly usdRates: Record<CurrencyCode, number>;

    constructor(usdRates: Record<CurrencyCode, number> = STATIC_USD_RATES) {
        this.usdRates = usdRates;
    }

    async getRates(base: CurrencyCode): Promise<ExchangeRate> {
        const baseUsd = this.usdRates[base];
        const rates: Record<string, number> = {};
        for (const code of Object.keys(this.usdRates) as CurrencyCode[]) {
            rates[code] = Number((this.usdRates[code] / baseUsd).toFixed(6));
        }
        return { base, rates, asOf: new Date().toISOString() };
    }
}

export class CurrencyService {
    private readonly rateProvider: ExchangeRateProvider;
    private readonly transactions: MultiCurrencyTransaction[] = [];

    constructor(rateProvider: ExchangeRateProvider = new StaticExchangeRateProvider()) {
        this.rateProvider = rateProvider;
    }

    /** Enabled currencies for player selection. */
    getSupportedCurrencies(): CurrencyInfo[] {
        return Object.values(CURRENCY_CATALOGUE).filter((info) => info.enabled);
    }

    isSupported(code: string): code is CurrencyCode {
        return Object.prototype.hasOwnProperty.call(CURRENCY_CATALOGUE, code);
    }

    /** Exchange rates for a base currency. */
    async getRates(base: CurrencyCode): Promise<ExchangeRate> {
        return this.rateProvider.getRates(base);
    }

    /** Convert `amount` from one currency to another. */
    async convert(from: CurrencyCode, to: CurrencyCode, amount: number): Promise<CurrencyConversion> {
        if (!Number.isFinite(amount)) {
            throw new Error('amount must be a finite number');
        }
        if (from === to) {
            return { from, to, amount, converted: amount, rate: 1 };
        }
        const { rates } = await this.rateProvider.getRates(from);
        const rate = rates[to];
        if (rate === undefined) {
            throw new Error(`No exchange rate for ${from} -> ${to}`);
        }
        const decimals = CURRENCY_CATALOGUE[to].decimals;
        return {
            from,
            to,
            amount,
            converted: Number((amount * rate).toFixed(decimals)),
            rate,
        };
    }

    /** Convert an amount to the platform base currency (NGN). */
    async toBase(amount: number, currency: CurrencyCode): Promise<number> {
        if (currency === BASE_CURRENCY) return amount;
        const { converted } = await this.convert(currency, BASE_CURRENCY, amount);
        return converted;
    }

    /** Payment gateways able to settle a currency. Unknown codes fall back to NGN. */
    getGateways(currency: string): string[] {
        return this.isSupported(currency)
            ? CURRENCY_CATALOGUE[currency].gateways
            : CURRENCY_CATALOGUE[BASE_CURRENCY].gateways;
    }

    /** Format an amount for display in the given currency. */
    format(amount: number, currency: CurrencyCode, locale?: string): string {
        const info = CURRENCY_CATALOGUE[currency];
        const resolvedLocale = locale ?? info.locales[0];
        try {
            return new Intl.NumberFormat(resolvedLocale, {
                style: 'currency',
                currency: info.code,
                minimumFractionDigits: info.decimals,
                maximumFractionDigits: info.decimals,
            }).format(amount);
        } catch {
            return `${info.symbol}${amount.toFixed(info.decimals)}`;
        }
    }

    /**
     * Record a transaction in any supported currency, normalising the amount
     * to the base currency so reporting stays consistent across currencies.
     */
    async recordTransaction(
        input: Omit<MultiCurrencyTransaction, 'id' | 'baseAmount' | 'baseCurrency' | 'createdAt'>,
    ): Promise<MultiCurrencyTransaction> {
        const baseAmount = await this.toBase(input.amount, input.currency);
        const transaction: MultiCurrencyTransaction = {
            ...input,
            id: `mctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            baseAmount,
            baseCurrency: BASE_CURRENCY,
            createdAt: new Date().toISOString(),
        };
        this.transactions.push(transaction);
        logger.info('Recorded multi-currency transaction', {
            id: transaction.id,
            currency: transaction.currency,
            baseAmount: transaction.baseAmount,
        });
        return transaction;
    }

    listTransactions(playerId?: string): MultiCurrencyTransaction[] {
        return playerId
            ? this.transactions.filter((tx) => tx.playerId === playerId)
            : [...this.transactions];
    }
}

export const currencyService = new CurrencyService();

export default currencyService;
