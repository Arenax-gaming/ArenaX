import JSONata from 'jsonata';
import { logger } from './logger.service';
import { metricsService } from './metrics.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransformationRule {
  id: string;
  name: string;
  description?: string;
  expression: string;       // JSONata expression string
  contentType?: string;     // Only apply to matching Content-Type
  status?: 'ACTIVE' | 'INACTIVE';
  priority?: number;        // Lower = applied first
  tags?: string[];
}

export interface TransformationContext {
  contentType: string;
  userId?: string;
  userRole?: string;
  queryParams?: Record<string, string>;
  endpoint?: string;
  metadata?: Record<string, unknown>;
}

export interface TransformationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  ruleId?: string;
  durationMs: number;
}

export interface TransformationAnalytics {
  totalTransformations: number;
  successes: number;
  failures: number;
  avgDurationMs: number;
  byRule: Record<string, { count: number; avgDurationMs: number }>;
}

// ---------------------------------------------------------------------------
// TransformationService
// ---------------------------------------------------------------------------

export class TransformationService {
  private static instance: TransformationService;

  private rules: Map<string, TransformationRule> = new Map();
  private compiledCache = new Map<string, JSONata.Expression>();
  private analytics: {
    total: number;
    successes: number;
    failures: number;
    durations: number[];
    byRule: Record<string, { count: number; durations: number[] }>;
  };

  private constructor() {
    this.analytics = {
      total: 0,
      successes: 0,
      failures: 0,
      durations: [],
      byRule: {},
    };
    logger.info('Transformation service initialized');
  }

  static getInstance(): TransformationService {
    if (!TransformationService.instance) {
      TransformationService.instance = new TransformationService();
    }
    return TransformationService.instance;
  }

  // -------------------------------------------------------------------------
  // Rule management
  // -------------------------------------------------------------------------

  /**
   * Register a transformation rule. Rules with lower priority are applied first.
   */
  registerRule(rule: TransformationRule): void {
    if (!rule.id) {
      throw new Error('Transformation rule must have an id');
    }
    // Compile and cache the JSONata expression
    try {
      const compiled = JSONata(rule.expression);
      this.compiledCache.set(rule.id, compiled);
      this.rules.set(rule.id, { ...rule, status: rule.status ?? 'ACTIVE' });
      logger.info('Transformation rule registered', { ruleId: rule.id, name: rule.name });
    } catch (err) {
      logger.error('Failed to compile transformation rule', { ruleId: rule.id, error: err });
      throw err;
    }
  }

  /**
   * Register multiple rules at once.
   */
  registerRules(rules: TransformationRule[]): void {
    for (const rule of rules) {
      this.registerRule(rule);
    }
  }

  /**
   * Update an existing rule.
   */
  updateRule(id: string, updates: Partial<TransformationRule>): void {
    const existing = this.rules.get(id);
    if (!existing) {
      throw new Error(`Transformation rule "${id}" not found`);
    }
    const merged = { ...existing, ...updates } as TransformationRule;
    // Re-compile if expression changed
    if (updates.expression) {
      try {
        const compiled = JSONata(merged.expression);
        this.compiledCache.set(id, compiled);
      } catch (err) {
        logger.error('Failed to recompile transformation rule', { ruleId: id, error: err });
        throw err;
      }
    }
    this.rules.set(id, merged);
    logger.info('Transformation rule updated', { ruleId: id });
  }

  /**
   * Remove a registered rule.
   */
  unregisterRule(id: string): void {
    this.rules.delete(id);
    this.compiledCache.delete(id);
    logger.info('Transformation rule unregistered', { ruleId: id });
  }

  /**
   * Get a rule by ID.
   */
  getRule(id: string): TransformationRule | undefined {
    return this.rules.get(id);
  }

  /**
   * List all registered rules, optionally filtered by status.
   */
  listRules(filter?: { status?: string; tag?: string }): TransformationRule[] {
    let rules = Array.from(this.rules.values());
    if (filter?.status) {
      rules = rules.filter((r) => r.status === filter.status);
    }
    if (filter?.tag) {
      rules = rules.filter((r) => r.tags?.includes(filter.tag!));
    }
    return rules.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  }

  /**
   * Clear all registered rules.
   */
  clearRules(): void {
    this.rules.clear();
    this.compiledCache.clear();
    logger.info('All transformation rules cleared');
  }

  // -------------------------------------------------------------------------
  // Transformation execution
  // -------------------------------------------------------------------------

  /**
   * Apply matching transformation rules to the response data.
   * Rules are applied in priority order (lower number = higher priority).
   */
  async transform<T = unknown>(
    data: unknown,
    context: TransformationContext
  ): Promise<TransformationResult<T>> {
    const start = Date.now();
    this.analytics.total++;

    const applicableRules = this.getApplicableRules(context);
    if (applicableRules.length === 0) {
      metricsService.recordCacheMiss('transformation');
      return {
        success: true,
        data: data as T,
        durationMs: Date.now() - start,
      };
    }

    let current = data;
    let lastRuleId: string | undefined;

    try {
      for (const rule of applicableRules) {
        const compiled = this.compiledCache.get(rule.id);
        if (!compiled) {
          logger.warn('Compiled rule not found, skipping', { ruleId: rule.id });
          continue;
        }

        const ruleStart = Date.now();
        const result = (compiled as any).evaluate(current);
        const ruleDuration = Date.now() - ruleStart;

        // Update per-rule analytics
        if (!this.analytics.byRule[rule.id]) {
          this.analytics.byRule[rule.id] = { count: 0, durations: [] };
        }
        this.analytics.byRule[rule.id].count++;
        this.analytics.byRule[rule.id].durations.push(ruleDuration);

        lastRuleId = rule.id;
        current = result;
      }

      const totalDuration = Date.now() - start;
      this.analytics.successes++;
      this.analytics.durations.push(totalDuration);

      metricsService.recordCacheHit('transformation');

      logger.debug('Transformation applied', {
        ruleIds: applicableRules.map((r) => r.id),
        durationMs: totalDuration,
      });

      return {
        success: true,
        data: current as T,
        ruleId: lastRuleId,
        durationMs: totalDuration,
      };
    } catch (err) {
      const totalDuration = Date.now() - start;
      this.analytics.failures++;
      this.analytics.durations.push(totalDuration);

      metricsService.recordError('transformation', 'medium');
      logger.error('Transformation failed', {
        error: err,
        ruleId: lastRuleId,
        durationMs: totalDuration,
      });

      return {
        success: false,
        error: err instanceof Error ? err.message : 'Transformation failed',
        ruleId: lastRuleId,
        durationMs: totalDuration,
      };
    }
  }

  /**
   * Apply a single transformation rule by ID.
   */
  async transformWithRule<T = unknown>(
    data: unknown,
    ruleId: string,
    context?: TransformationContext
  ): Promise<TransformationResult<T>> {
    const start = Date.now();
    this.analytics.total++;

    const rule = this.rules.get(ruleId);
    if (!rule || rule.status === 'INACTIVE') {
      return {
        success: false,
        error: `Rule "${ruleId}" not found or inactive`,
        durationMs: Date.now() - start,
      };
    }

    // Check content type filter
    if (rule.contentType && context?.contentType && !context.contentType.includes(rule.contentType)) {
      return {
        success: true,
        data: data as T,
        durationMs: Date.now() - start,
      };
    }

    try {
      const compiled = this.compiledCache.get(ruleId)!;
      const ruleStart = Date.now();
      const result = (compiled as any).evaluate(data);
      const ruleDuration = Date.now() - ruleStart;

      if (!this.analytics.byRule[ruleId]) {
        this.analytics.byRule[ruleId] = { count: 0, durations: [] };
      }
      this.analytics.byRule[ruleId].count++;
      this.analytics.byRule[ruleId].durations.push(ruleDuration);

      this.analytics.successes++;
      this.analytics.durations.push(ruleDuration);

      return {
        success: true,
        data: result as T,
        ruleId,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      this.analytics.failures++;
      metricsService.recordError('transformation', 'medium');
      logger.error('Single rule transformation failed', { ruleId, error: err });

      return {
        success: false,
        error: err instanceof Error ? err.message : 'Transformation failed',
        ruleId,
        durationMs: Date.now() - start,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Validate a JSONata expression without registering it as a rule.
   */
  validateExpression(expression: string): { valid: boolean; error?: string } {
    try {
      JSONata(expression);
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Invalid JSONata expression',
      };
    }
  }

  /**
   * Test a transformation expression against sample data.
   */
  async testTransformation(expression: string, sampleData: unknown): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
  }> {
    try {
      const compiled = JSONata(expression);
      const result = (compiled as any).evaluate(sampleData);
      return { success: true, result };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Transformation test failed',
      };
    }
  }

  // -------------------------------------------------------------------------
  // Analytics
  // -------------------------------------------------------------------------

  /**
   * Get transformation analytics summary.
   */
  getAnalytics(): TransformationAnalytics {
    const durations = this.analytics.durations;
    const avgDuration = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

    const byRule: Record<string, { count: number; avgDurationMs: number }> = {};
    for (const [ruleId, data] of Object.entries(this.analytics.byRule)) {
      const ruleDurations = data.durations;
      byRule[ruleId] = {
        count: data.count,
        avgDurationMs: ruleDurations.length > 0
          ? ruleDurations.reduce((sum, d) => sum + d, 0) / ruleDurations.length
          : 0,
      };
    }

    return {
      totalTransformations: this.analytics.total,
      successes: this.analytics.successes,
      failures: this.analytics.failures,
      avgDurationMs: avgDuration,
      byRule,
    };
  }

  /**
   * Reset analytics counters.
   */
  resetAnalytics(): void {
    this.analytics = {
      total: 0,
      successes: 0,
      failures: 0,
      durations: [],
      byRule: {},
    };
    logger.info('Transformation analytics reset');
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Get rules applicable to this context, sorted by priority.
   */
  private getApplicableRules(context: TransformationContext): TransformationRule[] {
    return this.listRules({ status: context.userRole === 'ADMIN' ? undefined : 'ACTIVE' })
      .filter((rule) => {
        // Apply content type filter
        if (rule.contentType && context.contentType && !context.contentType.includes(rule.contentType)) {
          return false;
        }
        // Apply tag filters (metadata tags)
        if (rule.tags && rule.tags.length > 0 && context.metadata?.tags) {
          const hasMatchingTag = rule.tags.some((tag) =>
            (context.metadata!.tags as string[]).includes(tag)
          );
          if (!hasMatchingTag) return false;
        }
        return true;
      })
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const transformationService = TransformationService.getInstance();