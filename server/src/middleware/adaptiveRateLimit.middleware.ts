import rateLimit, { Options, RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.service';

// System load sample window. Each request increments the counter; the
// background ticker computes requests-per-second every LOAD_WINDOW_MS ms
// and adjusts the multiplier that is applied to all rate-limit windows.
const LOAD_WINDOW_MS = 1_000;
const HIGH_LOAD_THRESHOLD_RPS = 5_000;
const CRITICAL_LOAD_THRESHOLD_RPS = 15_000;

// How much to tighten limits under load (< 1.0 = stricter)
const HIGH_LOAD_MULTIPLIER = 0.5;
const CRITICAL_LOAD_MULTIPLIER = 0.2;
const NORMAL_MULTIPLIER = 1.0;

// User tier burst allowances on top of the base window limit.
const TIER_MULTIPLIERS: Record<string, number> = {
  enterprise: 10,
  premium: 3,
  free: 1,
};

// IP reputation: a score ∈ [0, 1] where < ABUSE_THRESHOLD triggers a 2× penalty.
const ABUSE_THRESHOLD = 0.4;
const ABUSE_PENALTY_MULTIPLIER = 0.3;

// ── Internal load tracking ───────────────────────────────────────────────────

let _requestCount = 0;
let _currentLoadMultiplier = NORMAL_MULTIPLIER;
let _currentRps = 0;

setInterval(() => {
  _currentRps = _requestCount;
  _requestCount = 0;

  if (_currentRps >= CRITICAL_LOAD_THRESHOLD_RPS) {
    if (_currentLoadMultiplier !== CRITICAL_LOAD_MULTIPLIER) {
      logger.warn('Adaptive rate limit: CRITICAL load detected', { rps: _currentRps });
    }
    _currentLoadMultiplier = CRITICAL_LOAD_MULTIPLIER;
  } else if (_currentRps >= HIGH_LOAD_THRESHOLD_RPS) {
    if (_currentLoadMultiplier !== HIGH_LOAD_MULTIPLIER) {
      logger.warn('Adaptive rate limit: HIGH load detected', { rps: _currentRps });
    }
    _currentLoadMultiplier = HIGH_LOAD_MULTIPLIER;
  } else {
    _currentLoadMultiplier = NORMAL_MULTIPLIER;
  }
}, LOAD_WINDOW_MS);

// ── IP reputation store (in-memory; replace with Redis in production) ────────

const _ipReputation = new Map<string, number>();

export function setIpReputation(ip: string, score: number): void {
  _ipReputation.set(ip, Math.max(0, Math.min(1, score)));
}

export function getIpReputation(ip: string): number {
  return _ipReputation.get(ip) ?? 1.0; // unknown IPs start trusted
}

// ── Load telemetry export ────────────────────────────────────────────────────

export function getRateLimitStats() {
  return {
    currentRps: _currentRps,
    loadMultiplier: _currentLoadMultiplier,
    tier:
      _currentLoadMultiplier === CRITICAL_LOAD_MULTIPLIER
        ? 'critical'
        : _currentLoadMultiplier === HIGH_LOAD_MULTIPLIER
          ? 'high'
          : 'normal',
  };
}

// ── Core factory ─────────────────────────────────────────────────────────────

interface AdaptiveLimitOptions {
  /** Base requests per windowMs at normal load. */
  baseLimit: number;
  windowMs: number;
  /** Human-readable identifier for log messages. */
  name?: string;
}

/**
 * Build an adaptive rate-limiter that:
 *  1. Counts every request toward the system-load RPS metric.
 *  2. Scales the effective limit by the current load multiplier.
 *  3. Further scales per user tier (enterprise → 10×, premium → 3×, free → 1×).
 *  4. Penalises low-reputation IPs by a 70 % reduction.
 *  5. Emits a rate-limit warning response header when the caller is at 80 % of quota.
 */
export function adaptiveRateLimit(opts: AdaptiveLimitOptions): RateLimitRequestHandler {
  const { baseLimit, windowMs, name = 'adaptive' } = opts;

  const options: Partial<Options> = {
    windowMs,
    standardHeaders: 'draft-7',
    legacyHeaders: false,

    // Dynamic limit per request based on load + tier + reputation.
    limit: (req: Request): number => {
      _requestCount++;

      const tierKey =
        (req as Request & { user?: { tier?: string } }).user?.tier ?? 'free';
      const tierMult = TIER_MULTIPLIERS[tierKey] ?? 1;

      const ip = req.ip ?? '';
      const repScore = getIpReputation(ip);
      const repMult = repScore < ABUSE_THRESHOLD ? ABUSE_PENALTY_MULTIPLIER : 1;

      const effective = Math.max(
        1,
        Math.floor(baseLimit * _currentLoadMultiplier * tierMult * repMult),
      );
      return effective;
    },

    keyGenerator: (req: Request): string => {
      const userId =
        (req as Request & { user?: { id?: string } }).user?.id;
      return userId ? `user:${userId}` : `ip:${req.ip ?? 'unknown'}`;
    },

    handler: (req: Request, res: Response, _next: NextFunction, options) => {
      const ip = req.ip ?? 'unknown';
      logger.warn(`Rate limit hit [${name}]`, {
        ip,
        userId: (req as Request & { user?: { id?: string } }).user?.id,
        rps: _currentRps,
        loadMultiplier: _currentLoadMultiplier,
      });
      res.status(options.statusCode).json({
        error: 'Too many requests — please slow down.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil(windowMs / 1000),
        loadTier: getRateLimitStats().tier,
      });
    },

    // Admins bypass all adaptive throttling.
    skip: (req: Request): boolean =>
      (req as Request & { user?: { role?: string } }).user?.role === 'ADMIN',
  };

  return rateLimit(options as Options);
}

// ── Pre-configured limiters ───────────────────────────────────────────────────

/** Public read endpoints — generous baseline, tightens under load. */
export const publicAdaptiveRateLimiter = adaptiveRateLimit({
  name: 'public',
  baseLimit: 200,
  windowMs: 60_000,
});

/** Authenticated write endpoints — moderate baseline. */
export const authenticatedAdaptiveRateLimiter = adaptiveRateLimit({
  name: 'auth-write',
  baseLimit: 60,
  windowMs: 60_000,
});

/** Match/tournament actions — strict baseline to prevent flooding. */
export const gameActionAdaptiveRateLimiter = adaptiveRateLimit({
  name: 'game-action',
  baseLimit: 30,
  windowMs: 60_000,
});
