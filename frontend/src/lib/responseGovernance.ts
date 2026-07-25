/**
 * ArenaX — Response Governance
 *
 * Enforces structural and policy rules on every response flowing through the
 * interceptor pipeline. Violations are logged and forwarded to analytics;
 * "critical" violations can optionally throw to surface bugs early in dev.
 */

"use client";

import type {
  GovernancePolicy,
  GovernanceViolation,
  GovernanceViolationSeverity,
  ResponseMeta,
  StandardResponse,
} from "@/types/response";

// ─── Built-in policies ────────────────────────────────────────────────────────

/**
 * Warns when a response envelope is missing the expected `success` field.
 * Indicates the backend returned a non-standard shape.
 */
const envelopeShapePolicy: GovernancePolicy = {
  name: "envelope-shape",
  severity: "warn",
  validate(response) {
    if (response.success === undefined || response.success === null) {
      return "Response envelope is missing the `success` field";
    }
    return null;
  },
};

/**
 * Warns when a response has a 2xx status code but `success` is false.
 */
const successMismatchPolicy: GovernancePolicy = {
  name: "success-status-mismatch",
  severity: "warn",
  validate(response, meta) {
    if (
      meta.statusCode >= 200 &&
      meta.statusCode < 300 &&
      response.success === false
    ) {
      return `HTTP ${meta.statusCode} but response.success is false`;
    }
    return null;
  },
};

/**
 * Warns on unusually large payloads that could impact performance.
 * Threshold: 500 KB.
 */
const payloadSizePolicy: GovernancePolicy = {
  name: "payload-size",
  severity: "warn",
  validate(response) {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(response.data)).length;
      if (bytes > 500_000) {
        return `Response payload is ${Math.round(bytes / 1024)} KB — consider pagination`;
      }
    } catch {
      // TextEncoder may not be available in all environments; skip silently
    }
    return null;
  },
};

/**
 * Warns when an endpoint consistently returns 429 (rate limited).
 */
const rateLimitPolicy: GovernancePolicy = {
  name: "rate-limit",
  severity: "warn",
  validate(_response, meta) {
    if (meta.statusCode === 429) {
      return `Endpoint ${meta.requestPath} is being rate-limited`;
    }
    return null;
  },
};

/**
 * Errors when a response takes more than 10 seconds.
 * This is a governance error (structural), not a timeout (network error).
 */
const latencyThresholdPolicy: GovernancePolicy = {
  name: "latency-threshold",
  severity: "error",
  validate(_response, meta) {
    if (meta.latencyMs > 10_000) {
      return `Response latency ${meta.latencyMs}ms exceeds the 10 s governance threshold`;
    }
    return null;
  },
};

/** Default policy set applied to all responses. */
export const DEFAULT_POLICIES: GovernancePolicy[] = [
  envelopeShapePolicy,
  successMismatchPolicy,
  payloadSizePolicy,
  rateLimitPolicy,
  latencyThresholdPolicy,
];

// ─── Violation store ──────────────────────────────────────────────────────────

const MAX_VIOLATIONS = 100;
const _violations: GovernanceViolation[] = [];

function recordViolation(v: GovernanceViolation): void {
  _violations.unshift(v);
  if (_violations.length > MAX_VIOLATIONS) _violations.length = MAX_VIOLATIONS;
}

export function getGovernanceViolations(): readonly GovernanceViolation[] {
  return _violations;
}

export function clearGovernanceViolations(): void {
  _violations.length = 0;
}

export function getViolationsByEndpoint(
  endpoint: string,
): GovernanceViolation[] {
  return _violations.filter((v) => v.endpoint === endpoint);
}

export function getViolationsBySeverity(
  severity: GovernanceViolationSeverity,
): GovernanceViolation[] {
  return _violations.filter((v) => v.severity === severity);
}

// ─── Governance runner ────────────────────────────────────────────────────────

export interface GovernanceRunnerOptions {
  /** Additional custom policies to run alongside the defaults. */
  extraPolicies?: GovernancePolicy[];
  /**
   * If true, throw on "critical" violations (useful in development / CI).
   * Default: false
   */
  throwOnCritical?: boolean;
  /** Callback invoked for every violation (use for external logging). */
  onViolation?: (violation: GovernanceViolation) => void;
}

/**
 * Runs all governance policies against a response and records any violations.
 * Returns the list of violations found (empty array if all policies pass).
 */
export function runGovernance(
  response: StandardResponse,
  meta: ResponseMeta,
  options: GovernanceRunnerOptions = {},
): GovernanceViolation[] {
  const policies = [...DEFAULT_POLICIES, ...(options.extraPolicies ?? [])];
  const found: GovernanceViolation[] = [];

  for (const policy of policies) {
    try {
      const message = policy.validate(response, meta);
      if (message) {
        const violation: GovernanceViolation = {
          rule: policy.name,
          message,
          severity: policy.severity,
          endpoint: meta.requestPath,
          traceId: meta.traceId,
          timestamp: Date.now(),
        };
        found.push(violation);
        recordViolation(violation);
        options.onViolation?.(violation);

        if (process.env.NODE_ENV === "development") {
          const level =
            violation.severity === "critical" || violation.severity === "error"
              ? "error"
              : "warn";
          console[level](
            `[ArenaX Governance] [${violation.rule}] ${violation.message}`,
            { endpoint: violation.endpoint, traceId: violation.traceId },
          );
        }

        if (options.throwOnCritical && policy.severity === "critical") {
          throw new Error(
            `[ArenaX Governance] Critical violation: ${policy.name} — ${message}`,
          );
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("[ArenaX Governance]")) {
        throw err;
      }
      // Swallow unexpected errors from policy validators so they don't break responses
      console.error(`[ArenaX Governance] Policy "${policy.name}" threw:`, err);
    }
  }

  return found;
}

// ─── Governance summary ───────────────────────────────────────────────────────

export interface GovernanceSummary {
  totalViolations: number;
  byRule: Record<string, number>;
  bySeverity: Record<GovernanceViolationSeverity, number>;
  topOffendingEndpoints: Array<{ endpoint: string; count: number }>;
}

export function getGovernanceSummary(): GovernanceSummary {
  const byRule: Record<string, number> = {};
  const bySeverity: Record<GovernanceViolationSeverity, number> = {
    warn: 0,
    error: 0,
    critical: 0,
  };
  const endpointCounts: Record<string, number> = {};

  for (const v of _violations) {
    byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
    bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
    endpointCounts[v.endpoint] = (endpointCounts[v.endpoint] ?? 0) + 1;
  }

  const topOffendingEndpoints = Object.entries(endpointCounts)
    .map(([endpoint, count]) => ({ endpoint, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalViolations: _violations.length,
    byRule,
    bySeverity,
    topOffendingEndpoints,
  };
}
