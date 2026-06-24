import CircuitBreaker, { Options } from 'opossum';
import { logger } from './logger.service';
import { metricsService } from './metrics.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Failure threshold before opening the circuit. */
  errorThresholdPercentage?: number;
  /** How long the circuit stays open before testing recovery (ms). */
  resetTimeout?: number;
  /** Rolling window size for calculating error rate (ms). */
  rollingCountTimeout?: number;
  /** Max requests allowed when circuit is half-open. */
  halfOpenMaxRequests?: number;
  /** Rolling window buckets. */
  rollingCountBuckets?: number;
  /** Name for logging/metrics. */
  name?: string;
  /** Fallback to execute when circuit is OPEN or call fails. */
  fallback?: (...args: unknown[]) => Promise<unknown> | unknown;
  /** Timeout for underlying calls (ms). */
  timeout?: number;
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  timeouts: number;
  rejects: number;
  fallbacks: number;
  percentageError: number;
}

// ---------------------------------------------------------------------------
// CircuitBreakerService
// ---------------------------------------------------------------------------

export class CircuitBreakerService {
  private static instance: CircuitBreakerService;

  private breakers: Map<string, CircuitBreaker> = new Map();
  private stats: Map<string, CircuitStats> = new Map();

  private constructor() {
    logger.info('Circuit Breaker service initialized');
  }

  static getInstance(): CircuitBreakerService {
    if (!CircuitBreakerService.instance) {
      CircuitBreakerService.instance = new CircuitBreakerService();
    }
    return CircuitBreakerService.instance;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  create(name: string, fn: (...args: unknown[]) => Promise<unknown>, opts: CircuitBreakerOptions = {}): CircuitBreaker {
    if (this.breakers.has(name)) {
      return this.breakers.get(name)!;
    }

    const options: Options = {
      timeout: opts.timeout ?? 5000,
      errorThresholdPercentage: opts.errorThresholdPercentage ?? 50,
      resetTimeout: opts.resetTimeout ?? 30000,
      rollingCountTimeout: opts.rollingCountTimeout ?? 60000,
      rollingCountBuckets: opts.rollingCountBuckets ?? 10,
      name: opts.name ?? name,
    };

    const breaker = new CircuitBreaker(fn, options);

    breaker.on('success', () => this.recordSuccess(name));
    breaker.on('failure', (err: Error) => this.recordFailure(name, err));
    breaker.on('timeout', () => this.recordTimeout(name));
    breaker.on('reject', () => this.recordReject(name));
    breaker.on('open', () => {
      const stats = this.getStats(name);
      logger.warn('Circuit breaker opened', { name, stats });
      metricsService.recordError('circuit_breaker', 'high');
    });
    breaker.on('halfOpen', () => {
      logger.info('Circuit breaker half-open', { name });
    });
    breaker.on('close', () => {
      logger.info('Circuit breaker closed', { name });
    });

    if (opts.fallback) {
      breaker.fallback(opts.fallback);
    }

    this.breakers.set(name, breaker);
    this.initializeStats(name);
    logger.info('Circuit breaker created', { name, options });
    return breaker;
  }

  async fire(name: string, ...args: unknown[]): Promise<unknown> {
    const breaker = this.breakers.get(name);
    if (!breaker) {
      throw new Error(`Circuit breaker "${name}" not found. Create it first.`);
    }
    return breaker.fire(...args);
  }

  trip(name: string): void {
    const breaker = this.breakers.get(name);
    if (!breaker) {
      throw new Error(`Circuit breaker "${name}" not found.`);
    }
    breaker.open();
    logger.warn('Circuit breaker manually tripped', { name });
  }

  close(name: string): void {
    const breaker = this.breakers.get(name);
    if (!breaker) {
      throw new Error(`Circuit breaker "${name}" not found.`);
    }
    breaker.close();
    logger.info('Circuit breaker manually closed', { name });
  }

  getStats(name: string): CircuitStats {
    const stats = this.stats.get(name);
    if (!stats) {
      throw new Error(`Circuit breaker "${name}" not found.`);
    }
    return { ...stats };
  }

  getAllStats(): Record<string, CircuitStats> {
    const out: Record<string, CircuitStats> = {};
    for (const [name] of this.breakers) {
      out[name] = this.getStats(name);
    }
    return out;
  }

  destroy(name: string): void {
    const breaker = this.breakers.get(name);
    if (!breaker) return;
    breaker.shutdown();
    this.breakers.delete(name);
    this.stats.delete(name);
    logger.info('Circuit breaker destroyed', { name });
  }

  // -------------------------------------------------------------------------
  // Private telemetry helpers (class methods so `this` is typed)
  // -------------------------------------------------------------------------

  private initializeStats(name: string): void {
    this.stats.set(name, {
      state: 'CLOSED',
      failures: 0,
      successes: 0,
      timeouts: 0,
      rejects: 0,
      fallbacks: 0,
      percentageError: 0,
    });
  }

  private recordSuccess(name: string): void {
    const stats = this.stats.get(name);
    if (!stats) return;
    stats.successes++;
    this.updatePercentageError(stats);
  }

  private recordFailure(name: string, _err: Error): void {
    const stats = this.stats.get(name);
    if (!stats) return;
    stats.failures++;
    this.updatePercentageError(stats);
  }

  private recordTimeout(name: string): void {
    const stats = this.stats.get(name);
    if (!stats) return;
    stats.timeouts++;
    stats.failures++;
    this.updatePercentageError(stats);
    metricsService.recordError('circuit_breaker_timeout', 'high');
  }

  private recordReject(name: string): void {
    const stats = this.stats.get(name);
    if (!stats) return;
    stats.rejects++;
    metricsService.recordError('circuit_breaker_reject', 'medium');
  }

  private updatePercentageError(stats: CircuitStats): void {
    const total = stats.successes + stats.failures;
    stats.percentageError = total === 0 ? 0 : Math.round((stats.failures / total) * 100);
  }
}

// ---------------------------------------------------------------------------
// Pre-configured options for common external services
// ---------------------------------------------------------------------------

export type ExternalServiceName =
  | 'blockchain-rpc'
  | 'email-provider'
  | 'payment-gateway'
  | 'notification-service'
  | 'analytics-service';

export const ExternalServiceConfig: Record<ExternalServiceName, CircuitBreakerOptions> = {
  'blockchain-rpc': {
    timeout: 10000,
    errorThresholdPercentage: 30,
    resetTimeout: 15000,
    rollingCountTimeout: 30000,
    name: 'blockchain-rpc',
  },
  'email-provider': {
    timeout: 5000,
    errorThresholdPercentage: 40,
    resetTimeout: 60000,
    rollingCountTimeout: 60000,
    name: 'email-provider',
  },
  'payment-gateway': {
    timeout: 8000,
    errorThresholdPercentage: 20,
    resetTimeout: 30000,
    rollingCountTimeout: 30000,
    name: 'payment-gateway',
  },
  'notification-service': {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 10000,
    rollingCountTimeout: 30000,
    name: 'notification-service',
  },
  'analytics-service': {
    timeout: 3000,
    errorThresholdPercentage: 60,
    resetTimeout: 10000,
    rollingCountTimeout: 30000,
    name: 'analytics-service',
  },
};

export const circuitBreaker = CircuitBreakerService.getInstance();