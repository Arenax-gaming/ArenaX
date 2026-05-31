/**
 * Centralised environment configuration.
 *
 * All process.env reads for application config should go through the `env`
 * singleton exported from this module. Direct process.env access in service
 * files is a code smell — add the variable here instead.
 *
 * Loading order (handled by server.ts before this module is imported):
 *   .env.<NODE_ENV>.local   (machine-local overrides, git-ignored)
 *   .env.<NODE_ENV>         (environment-specific defaults, committed)
 *   .env.local              (cross-environment local overrides, git-ignored)
 *   .env                    (base defaults, committed)
 *
 * NODE_ENV must be set before the process starts (e.g. via the shell or a
 * process manager). It is never read from a .env file.
 */

import z from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Accept "true" / "1" / "yes" as truthy; everything else is false. */
const boolStr = z
    .string()
    .transform((v) => ['true', '1', 'yes'].includes(v.toLowerCase()));

/** Accept a numeric string and coerce to number. */
const intStr = (defaultVal: string) =>
    z.string().transform((v) => parseInt(v, 10)).default(defaultVal);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const envSchema = z.object({
    // ── Runtime ──────────────────────────────────────────────────────────────
    NODE_ENV: z
        .enum(['development', 'staging', 'production', 'test'])
        .default('development'),
    PORT: intStr('3001'),
    APP_VERSION: z.string().optional(),

    // ── Database ─────────────────────────────────────────────────────────────
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MIN: intStr('2'),
    DATABASE_POOL_MAX: intStr('10'),
    DATABASE_POOL_TIMEOUT: intStr('30'),
    DATABASE_IDLE_TIMEOUT: intStr('600'),

    // ── Authentication ───────────────────────────────────────────────────────
    JWT_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL: z.string().default('7d'),
    /** RS256 private key (inline PEM, \n-escaped). Takes precedence over JWT_SECRET. */
    JWT_PRIVATE_KEY: z.string().optional(),
    /** RS256 public key (inline PEM, \n-escaped). */
    JWT_PUBLIC_KEY: z.string().optional(),
    /** Path to RS256 private key file. Alternative to JWT_PRIVATE_KEY. */
    JWT_PRIVATE_KEY_FILE: z.string().optional(),
    /** Path to RS256 public key file. Alternative to JWT_PUBLIC_KEY. */
    JWT_PUBLIC_KEY_FILE: z.string().optional(),

    // ── Encryption ───────────────────────────────────────────────────────────
    ENCRYPTION_SECRET: z.string().min(32).optional(),
    WALLET_MASTER_KEYS: z.string().optional(),
    WALLET_ACTIVE_MASTER_KEY_VERSION: intStr('1').optional(),
    SENSITIVE_OPERATION_SECRET: z.string().optional(),

    // ── Logging ──────────────────────────────────────────────────────────────
    LOG_LEVEL: z
        .enum(['error', 'warn', 'info', 'debug', 'verbose', 'silly'])
        .default('info'),
    LOG_DIR: z.string().optional(),
    LOG_MAX_SIZE: z.string().default('20m'),
    LOG_MAX_FILES: z.string().default('14d'),

    // ── CORS / Origins ───────────────────────────────────────────────────────
    ARENAX_ALLOWED_ORIGINS: z.string().optional(),
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    BACKEND_URL: z.string().url().default('http://localhost:3001'),

    // ── Redis / Cache ────────────────────────────────────────────────────────
    REDIS_URL: z.string().url().optional(),
    PROFILE_CACHE_TTL_SECONDS: intStr('300'),

    // ── Rate Limiting ────────────────────────────────────────────────────────
    RATE_LIMIT_TRUSTED_IPS: z.string().optional(),
    RATE_LIMIT_TRUSTED_ACCOUNTS: z.string().optional(),

    // ── Metrics ──────────────────────────────────────────────────────────────
    METRICS_ENABLED: boolStr.default('true'),
    METRICS_PORT: intStr('9090'),

    // ── Health Monitor ───────────────────────────────────────────────────────
    HEALTH_CHECK_INTERVAL_MS: intStr('60000'),

    // ── Telemetry (Sentry) ───────────────────────────────────────────────────
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z
        .string()
        .transform((v) => parseFloat(v))
        .default('0'),

    // ── Email ────────────────────────────────────────────────────────────────
    EMAIL_HOST: z.string().default('localhost'),
    EMAIL_PORT: intStr('587'),
    EMAIL_SECURE: boolStr.default('false'),
    EMAIL_USER: z.string().optional(),
    EMAIL_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().email().default('noreply@arenax.gg'),

    // ── OAuth Providers ──────────────────────────────────────────────────────
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    DISCORD_CLIENT_ID: z.string().optional(),
    DISCORD_CLIENT_SECRET: z.string().optional(),
    TWITCH_CLIENT_ID: z.string().optional(),
    TWITCH_CLIENT_SECRET: z.string().optional(),

    // ── Stellar / Blockchain ─────────────────────────────────────────────────
    STELLAR_NETWORK: z.enum(['TESTNET', 'MAINNET']).default('TESTNET'),
    HORIZON_URL: z
        .string()
        .url()
        .default('https://horizon-testnet.stellar.org'),
    STELLAR_HORIZON_URL: z
        .string()
        .url()
        .optional(),
    SOROBAN_RPC_URL: z
        .string()
        .url()
        .default('https://soroban-testnet.stellar.org'),
    SOROBAN_RPC_FAILOVERS: z.string().optional(),
    ADMIN_SECRET_KEY: z.string().optional(),
    FEE_PAYER_SECRET_KEY: z.string().optional(),
    FEE_PAYER_PUBLIC_KEY: z.string().optional(),

    // ── External Payments ────────────────────────────────────────────────────
    PAYSTACK_SECRET_KEY: z.string().optional(),
    FLUTTERWAVE_SECRET_KEY: z.string().optional(),

    // ── Webhooks / Notifications ─────────────────────────────────────────────
    ADMIN_WEBHOOK_URL: z.string().url().optional(),
    SECURITY_WEBHOOK_URL: z.string().url().optional(),
});

// ---------------------------------------------------------------------------
// Derived helpers (computed once, not re-read from process.env)
// ---------------------------------------------------------------------------

export type Env = z.infer<typeof envSchema>;

export interface DerivedEnv extends Env {
    /** True only in production. */
    isProduction: boolean;
    /** True in staging or production. */
    isProductionLike: boolean;
    /** True only in development. */
    isDevelopment: boolean;
    /** True only in test. */
    isTest: boolean;
    /** True only in staging. */
    isStaging: boolean;
    /** Effective Horizon URL — STELLAR_HORIZON_URL takes precedence over HORIZON_URL. */
    effectiveHorizonUrl: string;
    /** Stellar network passphrase string. */
    stellarNetworkPassphrase: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Parse and validate process.env, then attach derived helpers.
 * Exits the process with code 1 on validation failure so misconfigured
 * deployments fail loudly at startup rather than silently misbehaving.
 */
export const validateEnv = (): DerivedEnv => {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        // Use console.error here — logger is not yet initialised at this point.
        console.error(
            '[env] Environment validation failed:\n',
            JSON.stringify(result.error.format(), null, 2)
        );
        process.exit(1);
    }

    const parsed = result.data;

    const derived: DerivedEnv = {
        ...parsed,
        isProduction: parsed.NODE_ENV === 'production',
        isProductionLike:
            parsed.NODE_ENV === 'production' || parsed.NODE_ENV === 'staging',
        isDevelopment: parsed.NODE_ENV === 'development',
        isTest: parsed.NODE_ENV === 'test',
        isStaging: parsed.NODE_ENV === 'staging',
        effectiveHorizonUrl:
            parsed.STELLAR_HORIZON_URL ?? parsed.HORIZON_URL,
        stellarNetworkPassphrase:
            parsed.STELLAR_NETWORK === 'MAINNET'
                ? 'Public Global Stellar Network ; September 2015'
                : 'Test SDF Network ; September 2015',
    };

    return derived;
};

// ---------------------------------------------------------------------------
// Singleton — call validateEnv() once in server.ts; import `env` everywhere
// else.
// ---------------------------------------------------------------------------

let _env: DerivedEnv | null = null;

/**
 * Return the validated environment singleton.
 * Throws if `validateEnv()` has not been called yet (i.e. before server.ts
 * runs). This makes import-order bugs visible immediately.
 */
export const getEnv = (): DerivedEnv => {
    if (!_env) {
        throw new Error(
            '[env] getEnv() called before validateEnv(). ' +
            'Ensure server.ts calls validateEnv() at startup.'
        );
    }
    return _env;
};

/**
 * Initialise the singleton. Called once by server.ts after dotenv has loaded
 * the correct .env file.
 */
export const initEnv = (): DerivedEnv => {
    _env = validateEnv();
    return _env;
};

/** Reset the singleton — for use in tests only. */
export const resetEnv = (): void => {
    _env = null;
};
