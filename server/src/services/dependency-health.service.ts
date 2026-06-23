/**
 * Foundation for the Kubernetes-style readiness probes tracked in #483.
 *
 * The current `health.service.ts` is an interval-driven *alerting*
 * monitor — it watches an aggregate "system health" metric and pings
 * a webhook when something looks bad. That's a useful signal but it
 * doesn't answer the question Kubernetes needs answered:
 *
 *     "Is this pod ready to serve traffic right now?"
 *
 * This file owns that question. Every dependency the request path
 * touches (DB, Redis, blockchain RPC, external KYC, …) registers a
 * probe; the readiness aggregate returns the worst-case status of any
 * required probe. Liveness is the cheaper "did the process panic"
 * check that returns OK as long as the event loop is responsive.
 *
 * The HTTP routes that mount these (e.g. `GET /healthz`,
 * `GET /readyz`) live in a follow-up — this file just owns the
 * registry + aggregation logic so the wiring stays a one-liner.
 */

export type ProbeStatus = 'pass' | 'warn' | 'fail'

export interface ProbeResult {
    name: string
    status: ProbeStatus
    /** Round-trip latency of the probe call itself. */
    latencyMs: number
    /** Optional human-readable detail surfaced in the readiness payload. */
    message?: string
    /** True when this probe's failure should fail the readiness aggregate. */
    required: boolean
}

export interface DependencyProbe {
    name: string
    /** Required probes fail the readiness aggregate; optional ones only warn. */
    required: boolean
    /** Bail and report `fail` if the probe takes longer than this. */
    timeoutMs: number
    check: () => Promise<{ status: ProbeStatus; message?: string }>
}

export interface ReadinessSnapshot {
    status: ProbeStatus
    checkedAt: number
    probes: ProbeResult[]
}

export class DependencyHealthRegistry {
    private readonly probes = new Map<string, DependencyProbe>()

    constructor(private readonly now: () => number = Date.now) {}

    register(probe: DependencyProbe): void {
        if (probe.timeoutMs <= 0) {
            throw new Error('dependency-health: timeoutMs must be positive')
        }
        this.probes.set(probe.name, probe)
    }

    unregister(name: string): void {
        this.probes.delete(name)
    }

    async runAll(): Promise<ReadinessSnapshot> {
        const checkedAt = this.now()
        const probes = await Promise.all(
            Array.from(this.probes.values()).map((probe) => this.runOne(probe)),
        )

        const requiredFailed = probes.some((p) => p.required && p.status === 'fail')
        const anyFailed = probes.some((p) => p.status === 'fail')
        const anyWarn = probes.some((p) => p.status === 'warn')

        const status: ProbeStatus = requiredFailed
            ? 'fail'
            : anyFailed || anyWarn
                ? 'warn'
                : 'pass'

        return { status, checkedAt, probes }
    }

    private async runOne(probe: DependencyProbe): Promise<ProbeResult> {
        const startedAt = this.now()

        let timeoutId: NodeJS.Timeout | null = null
        const timeoutPromise = new Promise<{ status: ProbeStatus; message?: string }>(
            (resolve) => {
                timeoutId = setTimeout(
                    () => resolve({ status: 'fail', message: 'probe timed out' }),
                    probe.timeoutMs,
                )
            },
        )

        let result: { status: ProbeStatus; message?: string }
        try {
            result = await Promise.race([probe.check(), timeoutPromise])
        } catch (err) {
            result = { status: 'fail', message: err instanceof Error ? err.message : String(err) }
        } finally {
            if (timeoutId) clearTimeout(timeoutId)
        }

        return {
            name: probe.name,
            status: result.status,
            latencyMs: this.now() - startedAt,
            message: result.message,
            required: probe.required,
        }
    }
}

const globalRegistry = new DependencyHealthRegistry()

export function getDependencyHealthRegistry(): DependencyHealthRegistry {
    return globalRegistry
}

/**
 * Convenience builders for the probes #483 calls out by name.
 *
 * Each builder accepts a thin async check so the service that owns the
 * dependency (db, redis, blockchain RPC) does not import this file —
 * keeping the dependency direction one-way (service → registration on
 * bootstrap).
 */
export function buildDatabaseProbe(check: () => Promise<void>): DependencyProbe {
    return {
        name: 'database',
        required: true,
        timeoutMs: 1_000,
        check: async () => {
            await check()
            return { status: 'pass' }
        },
    }
}

export function buildRedisProbe(check: () => Promise<void>): DependencyProbe {
    return {
        name: 'redis',
        required: false,
        timeoutMs: 500,
        check: async () => {
            await check()
            return { status: 'pass' }
        },
    }
}

export function buildBlockchainRpcProbe(
    check: () => Promise<void>,
    options: { required?: boolean } = {},
): DependencyProbe {
    return {
        name: 'blockchain-rpc',
        required: options.required ?? false,
        timeoutMs: 1_500,
        check: async () => {
            await check()
            return { status: 'pass' }
        },
    }
}
