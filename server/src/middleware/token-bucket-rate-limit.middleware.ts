import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.service';
import { metricsService } from '../services/metrics.service';

// ---------------------------------------------------------------------------
// Token Bucket types
// ---------------------------------------------------------------------------

export interface TokenBucketConfig {
  capacity: number;
  refillRate: number;
  cost?: number;
  identifier?: string;
}

export interface TokenBucketState {
  tokens: number;
  lastRefill: number;
}

// ---------------------------------------------------------------------------
// TokenBucketStore
// ---------------------------------------------------------------------------

export interface ITokenBucketStore {
  get(identifier: string): TokenBucketState | undefined;
  set(identifier: string, state: TokenBucketState): void;
  delete(identifier: string): void;
  cleanup?(maxAge: number): void;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

export class InMemoryTokenBucketStore implements ITokenBucketStore {
  private store = new Map<string, TokenBucketState>();

  get(identifier: string): TokenBucketState | undefined {
    return this.store.get(identifier);
  }

  set(identifier: string, state: TokenBucketState): void {
    this.store.set(identifier, state);
  }

  delete(identifier: string): void {
    this.store.delete(identifier);
  }

  cleanup(maxAge: number): void {
    const cutoff = Date.now() - maxAge;
    for (const [key, state] of this.store.entries()) {
      if (state.lastRefill < cutoff) {
        this.store.delete(key);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }
}

// ---------------------------------------------------------------------------
// Core TokenBucket
// ---------------------------------------------------------------------------

export class TokenBucket {
  private state: TokenBucketState;
  private capacity: number;
  private refillRate: number;
  private cost: number;
  private identifier: string;

  constructor(initialState: TokenBucketState, config: TokenBucketConfig) {
    this.state = { ...initialState };
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
    this.cost = config.cost ?? 1;
    this.identifier = config.identifier ?? 'default';
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.state.lastRefill) / 1000;
    const newTokens = Math.min(this.capacity, this.state.tokens + elapsedSec * this.refillRate);
    this.state.tokens = newTokens;
    this.state.lastRefill = now;
  }

  tryConsume(cost = this.cost): boolean {
    this.refill();
    if (this.state.tokens >= cost) {
      this.state.tokens -= cost;
      return true;
    }
    return false;
  }

  get remainingTokens(): number {
    this.refill();
    return this.state.tokens;
  }

  get timeUntilRefillMs(): number {
    this.refill();
    if (this.state.tokens >= this.cost) return 0;
    const deficit = this.cost - this.state.tokens;
    return Math.ceil((deficit / this.refillRate) * 1000);
  }

  getState(): TokenBucketState {
    this.refill();
    return { ...this.state };
  }
}

// ---------------------------------------------------------------------------
// Middleware Rate Limiter
// ---------------------------------------------------------------------------

export interface TokenBucketLimiterOptions {
  headerPrefix?: string;
  identify?(req: Request): string;
  escalation?: {
    threshold: number;
    multiplier: number;
    durationMs: number;
  };
  store?: ITokenBucketStore;
}

export interface BucketViolation {
  identifier: string;
  violations: number;
  retryAfterMs: number;
  escalated: boolean;
}

interface EscalationEntry {
  expiresAt: number;
  multiplier: number;
}

export class TokenBucketRateLimiter {
  private store: ITokenBucketStore;
  private capacity: number;
  private refillRate: number;
  private cost: number;
  private headerPrefix: string;
  private identify: (req: Request) => string;
  private escalation: TokenBucketLimiterOptions['escalation'];
  private escalations = new Map<string, EscalationEntry>();
  private violations = new Map<string, number>();

  constructor(
    private config: TokenBucketConfig,
    options: TokenBucketLimiterOptions = {}
  ) {
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
    this.cost = config.cost ?? 1;
    this.store = options.store ?? new InMemoryTokenBucketStore();
    this.headerPrefix = options.headerPrefix ?? 'X-RateLimit';
    this.identify = options.identify ?? defaultIdentifier;
    this.escalation = options.escalation;
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const id = this.identify(req);
      const effective = this.resolveEffectiveConfig(id);

      let bucket = this.store.get(id);
      if (!bucket) {
        bucket = { tokens: effective.capacity, lastRefill: Date.now() };
        this.store.set(id, bucket);
      }

      const tokenBucket = new TokenBucket(bucket, effective);

      if (!tokenBucket.tryConsume(effective.cost)) {
        const violations = (this.violations.get(id) ?? 0) + 1;
        this.violations.set(id, violations);
        const escalated = this.maybeEscalate(id, violations);

        metricsService.recordError('token_bucket_reject', escalated ? 'high' : 'medium');
        logger.warn('Token bucket rate limit hit', {
          identifier: id,
          remaining: tokenBucket.remainingTokens,
          retryAfterMs: tokenBucket.timeUntilRefillMs,
          violations,
          escalated,
        });

        res.set({
          [`${this.headerPrefix}-Limit`]: String(effective.capacity),
          [`${this.headerPrefix}-Remaining`]: '0',
          [`${this.headerPrefix}-Reset`]: String(Math.ceil(tokenBucket.timeUntilRefillMs / 1000)),
        });

        res.status(429).json({
          error: 'Rate limit exceeded',
          code: 'TOKEN_BUCKET_RATE_LIMIT',
          retryAfter: Math.ceil(tokenBucket.timeUntilRefillMs / 1000),
          escalated,
        });
        return;
      }

      this.store.set(id, tokenBucket.getState());

      res.set({
        [`${this.headerPrefix}-Limit`]: String(effective.capacity),
        [`${this.headerPrefix}-Remaining`]: String(Math.floor(tokenBucket.remainingTokens)),
      });

      next();
    };
  }

  getState(identifier: string): TokenBucketState | undefined {
    return this.store.get(identifier);
  }

  reset(identifier: string): void {
    this.store.delete(identifier);
    this.violations.delete(identifier);
    this.escalations.delete(identifier);
  }

  cleanup(): void {
    if (this.store.cleanup) {
      this.store.cleanup(60_000);
    }
  }

  private resolveEffectiveConfig(identifier: string): TokenBucketConfig {
    const esc = this.escalations.get(identifier);
    if (esc && esc.expiresAt > Date.now()) {
      return {
        capacity: Math.floor(this.capacity * esc.multiplier),
        refillRate: this.refillRate * esc.multiplier,
        cost: this.cost,
        identifier: this.config.identifier,
      };
    }
    return { ...this.config };
  }

  private maybeEscalate(identifier: string, violations: number): boolean {
    if (!this.escalation) return false;
    if (violations < this.escalation.threshold) return false;

    const existing = this.escalations.get(identifier);
    if (existing && existing.expiresAt > Date.now()) {
      return true;
    }

    this.escalations.set(identifier, {
      expiresAt: Date.now() + this.escalation.durationMs,
      multiplier: this.escalation.multiplier,
    });

    logger.warn('Token bucket rate limit escalated', { identifier, multiplier: this.escalation.multiplier, durationMs: this.escalation.durationMs });
    return true;
  }
}

function defaultIdentifier(req: Request): string {
  const user = (req as Request & { user?: { id?: string } }).user;
  return user?.id ? `user:${user.id}` : `ip:${req.ip ?? 'unknown'}`;
}

export const createTokenBucketLimiter = (config: TokenBucketConfig, opts?: TokenBucketLimiterOptions): TokenBucketRateLimiter => {
  return new TokenBucketRateLimiter(config, opts);
};

export const authTokenBucketLimiter = createTokenBucketLimiter(
  { capacity: 5, refillRate: 5 / 60, identifier: 'auth' },
  { escalation: { threshold: 3, multiplier: 0.1, durationMs: 300_000 } }
);

export const paymentTokenBucketLimiter = createTokenBucketLimiter(
  { capacity: 10, refillRate: 10 / 60, identifier: 'payment' },
  { escalation: { threshold: 5, multiplier: 0.2, durationMs: 600_000 } }
);

export const gameActionTokenBucketLimiter = createTokenBucketLimiter(
  { capacity: 30, refillRate: 30 / 60, identifier: 'game-action' },
  { escalation: { threshold: 10, multiplier: 0.5, durationMs: 300_000 } }
);

export const generalTokenBucketLimiter = createTokenBucketLimiter(
  { capacity: 100, refillRate: 100 / 60, identifier: 'general' },
  { escalation: { threshold: 20, multiplier: 0.3, durationMs: 300_000 } }
);