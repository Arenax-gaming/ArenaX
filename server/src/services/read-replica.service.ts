import { PrismaClient } from '@prisma/client'
import type { DatabaseClient } from './database.service'

/**
 * Foundation for the read-replica routing tracked in #472.
 *
 * The existing database.service.ts owns a single PrismaClient pointed at
 * the primary. This file layers a replica pool on top:
 *
 *   - Each replica URL is wrapped in its own PrismaClient instance.
 *   - The router exposes `read()` and `write()` accessors. Routes that
 *     are known-safe (cache reads, list endpoints, public profiles)
 *     pick `read()`; everything else stays on the primary via `write()`.
 *   - Replicas are health-tracked: a failed query during a probe pulls
 *     the replica out of rotation for `OFFLINE_PROBE_MS`; a healthy
 *     probe restores it.
 *   - Read-after-write consistency is enforced by sticky routing: when
 *     a route emits a write the caller can pin subsequent reads in the
 *     same request to the primary using {@link withWritePin}.
 *
 * Adding replicas is now a config change (`DATABASE_READ_REPLICA_URLS`)
 * rather than a code change.
 */

const PROBE_INTERVAL_MS = 30_000
const OFFLINE_PROBE_MS = 60_000

interface Replica {
    url: string
    client: PrismaClient
    healthy: boolean
    lastProbeAt: number
    lagMs?: number
}

export interface ReadReplicaRouter {
    read(): DatabaseClient
    write(): DatabaseClient
    /** Pin all `read()` calls inside `fn` to the write database. */
    withWritePin<T>(fn: () => Promise<T>): Promise<T>
    /** Drop every PrismaClient — used in tests + on shutdown. */
    disconnectAll(): Promise<void>
    /** Public snapshot used by the /healthz dependency probe. */
    snapshot(): {
        primary: { url: string }
        replicas: Array<{ url: string; healthy: boolean; lagMs?: number }>
    }
}

function parseReplicaUrls(raw: string | undefined): string[] {
    if (!raw) return []
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
}

class StickyReadReplicaRouter implements ReadReplicaRouter {
    private writePin = 0
    private cursor = 0
    private readonly probes = new Map<string, NodeJS.Timeout>()

    constructor(
        private readonly primary: { url: string; client: DatabaseClient },
        private readonly replicas: Replica[],
    ) {
        for (const replica of replicas) {
            this.startProbe(replica)
        }
    }

    private startProbe(replica: Replica): void {
        if (this.probes.has(replica.url)) return
        const tick = async () => {
            const startedAt = Date.now()
            try {
                await replica.client.$queryRaw`SELECT 1`
                replica.healthy = true
                replica.lagMs = Date.now() - startedAt
            } catch {
                replica.healthy = false
            }
            replica.lastProbeAt = Date.now()
            this.probes.set(
                replica.url,
                setTimeout(tick, replica.healthy ? PROBE_INTERVAL_MS : OFFLINE_PROBE_MS),
            )
        }
        // Kick off the first probe asynchronously so construction never
        // blocks the import path.
        this.probes.set(replica.url, setTimeout(tick, 0))
    }

    read(): DatabaseClient {
        if (this.writePin > 0) return this.primary.client
        const healthy = this.replicas.filter((r) => r.healthy)
        if (healthy.length === 0) return this.primary.client
        const pick = healthy[this.cursor % healthy.length]
        this.cursor = (this.cursor + 1) % healthy.length
        return pick.client as unknown as DatabaseClient
    }

    write(): DatabaseClient {
        return this.primary.client
    }

    async withWritePin<T>(fn: () => Promise<T>): Promise<T> {
        this.writePin += 1
        try {
            return await fn()
        } finally {
            this.writePin -= 1
        }
    }

    async disconnectAll(): Promise<void> {
        for (const timer of this.probes.values()) clearTimeout(timer)
        this.probes.clear()
        await Promise.allSettled(this.replicas.map((r) => r.client.$disconnect()))
    }

    snapshot() {
        return {
            primary: { url: this.primary.url },
            replicas: this.replicas.map((r) => ({
                url: r.url,
                healthy: r.healthy,
                lagMs: r.lagMs,
            })),
        }
    }
}

/**
 * Build a router around the supplied primary client. Use this from
 * server bootstrap so the primary connection is owned by
 * database.service.ts (single source of truth) and the router just
 * borrows it as the "write" target.
 */
export function buildReadReplicaRouter(
    primary: { url: string; client: DatabaseClient },
    replicaUrls: string[] = parseReplicaUrls(process.env.DATABASE_READ_REPLICA_URLS),
): ReadReplicaRouter {
    const replicas: Replica[] = replicaUrls.map((url) => ({
        url,
        client: new PrismaClient({ datasources: { db: { url } } }),
        // Optimistic: the first probe will demote unhealthy replicas
        // within a second of bootstrap.
        healthy: true,
        lastProbeAt: 0,
    }))
    return new StickyReadReplicaRouter(primary, replicas)
}

let activeRouter: ReadReplicaRouter | null = null

export function getReadReplicaRouter(): ReadReplicaRouter | null {
    return activeRouter
}

export function setReadReplicaRouter(router: ReadReplicaRouter | null): void {
    activeRouter = router
}
