import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from './logger.service';
import { metricsService } from './metrics.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShardId = string;

export interface ShardConfig {
  id: ShardId;
  datasourceUrl: string;
  weight?: number;            // For weighted distribution
  region?: string;            // Geographic region label
  status?: 'active' | 'inactive' | 'maintenance';
}

export interface ShardRouteResult {
  shardId: ShardId;
  client: PrismaClient;
}

export interface ShardKey {
  /** Resolve shard id for given record. */
  resolve(record: { [key: string]: unknown }): ShardId;
}

interface RebalancePlan {
  fromShard: ShardId;
  toShard: ShardId;
  model: string;
  estimatedRows: number;
}

interface ShardHealth {
  shardId: ShardId;
  healthy: boolean;
  latencyMs: number | null;
  lastChecked: Date;
}

// ---------------------------------------------------------------------------
// ShardRouter
// ---------------------------------------------------------------------------

export class ShardRouter {
  private shards = new Map<ShardId, ShardConfig>();
  private clients = new Map<ShardId, PrismaClient>();
  private shardKey: ShardKey;
  private health = new Map<ShardId, ShardHealth>();

  constructor(shardKey: ShardKey) {
    this.shardKey = shardKey;
    logger.info('Shard router initialized');
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * Register a shard.
   */
  registerShard(config: ShardConfig): void {
    this.shards.set(config.id, { ...config, status: config.status ?? 'active' });
    this.health.set(config.id, {
      shardId: config.id,
      healthy: true,
      latencyMs: null,
      lastChecked: new Date(),
    });
    logger.info('Shard registered', { shardId: config.id, region: config.region });
  }

  /**
   * Register multiple shards.
   */
  registerShards(shards: ShardConfig[]): void {
    for (const config of shards) {
      this.registerShard(config);
    }
  }

  /**
   * Resolve the PrismaClient responsible for the given record.
   */
  route(record: { [key: string]: unknown }): ShardRouteResult {
    const shardId = this.shardKey.resolve(record);
    const config = this.shards.get(shardId);

    if (!config || config.status === 'inactive') {
      throw new Error(`Shard "${shardId}" not found or inactive`);
    }

    let client = this.clients.get(shardId);
    if (!client) {
      client = this.createPrismaClient(config.datasourceUrl);
      this.clients.set(shardId, client);
    }

    return { shardId, client };
  }

  /**
   * List all registered shards.
   */
  listShards(): ShardConfig[] {
    return Array.from(this.shards.values());
  }

  /**
   * Get active shard count.
   */
  getActiveShardCount(): number {
    return Array.from(this.shards.values()).filter((s) => s.status !== 'inactive').length;
  }

  /**
   * Get health snapshot for all shards.
   */
  getHealth(): ShardHealth[] {
    return Array.from(this.health.values());
  }

  // -------------------------------------------------------------------------
  // Operations (fan-out to all shards)
  // -------------------------------------------------------------------------

  /**
   * Execute a callback on every active shard.
   */
  async forEachShard<T>(fn: (client: PrismaClient, shardId: ShardId) => Promise<T>): Promise<T[]> {
    const results: T[] = [];
    const activeShards = Array.from(this.shards.values()).filter((s) => s.status === 'active' || s.status === 'maintenance');

    for (const config of activeShards) {
      const client = this.clients.get(config.id) || this.createPrismaClient(config.datasourceUrl);
      this.clients.set(config.id, client);
      results.push(await fn(client, config.id));
    }

    return results;
  }

  /**
   * Execute a read-only aggregation across shards.
   */
  async aggregateAll<T>(aggregator: (results: T[]) => T): Promise<T> {
    const results = await this.forEachShard(async (client) => {
      // Caller decides HOW to query each shard, we just provide the client.
      // This wrapper intentionally splits into two phases: fetch then aggregate.
      return { _shardClient: client };
    });

    // The caller needs to pass actual data; this helper is a shell. We expose
    // the lower-level forEachShard for real work.
    throw new Error('Use forEachShard() for shard-wide aggregation.');
  }

  // -------------------------------------------------------------------------
  // Monitoring
  // -------------------------------------------------------------------------

  async checkHealth(): Promise<ShardHealth[]> {
    const checks = await this.forEachShard(async (client, shardId) => {
      const start = Date.now();
      try {
        await client.$queryRaw`SELECT 1`;
        const latencyMs = Date.now() - start;
        this.health.set(shardId, {
          shardId,
          healthy: true,
          latencyMs,
          lastChecked: new Date(),
        });
        metricsService.recordDbQuery('health', shardId, latencyMs / 1000, 'success');
        return { shardId, healthy: true, latencyMs, lastChecked: new Date() };
      } catch (err) {
        logger.error('Shard health check failed', { shardId, error: err });
        this.health.set(shardId, {
          shardId,
          healthy: false,
          latencyMs: null,
          lastChecked: new Date(),
        });
        metricsService.recordDbQuery('health', shardId, 0, 'error');
        return { shardId, healthy: false, latencyMs: null, lastChecked: new Date() };
      }
    });

    return checks;
  }

  // -------------------------------------------------------------------------
  // Rebalancing
  // -------------------------------------------------------------------------

  /**
   * Generate rebalance plan (does not execute).
   */
  planRebalance(model: string, threshold?: number): RebalancePlan[] {
    const plans: RebalancePlan[] = [];
    const activeShards = Array.from(this.shards.values()).filter((s) => s.status === 'active');

    // Placeholder heuristic: distribute evenly across shards.
    // In production, you would gather row counts per shard and compare.
    for (let i = 0; i < activeShards.length - 1; i++) {
      plans.push({
        fromShard: activeShards[i].id,
        toShard: activeShards[i + 1].id,
        model,
        estimatedRows: 0,
      });
    }

    return plans;
  }

  /**
   * Gracefully disconnect all shard clients.
   */
  async disconnect(): Promise<void> {
    for (const [id, client] of this.clients.entries()) {
      await client.$disconnect().catch((err) => {
        logger.warn('Error disconnecting shard client', { shardId: id, error: err });
      });
      this.clients.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private createPrismaClient(datasourceUrl: string): PrismaClient {
    return new PrismaClient({
      datasources: {
        db: { url: datasourceUrl },
      },
      log: ['error'],
    });
  }
}

// ---------------------------------------------------------------------------
// Common shard key strategies
// ---------------------------------------------------------------------------

export class UserIdShardKey implements ShardKey {
  private mapping: Map<ShardId, string[]>;
  private defaultShard: ShardId;

  constructor(mapping: Map<ShardId, string[]>, defaultShard: ShardId) {
    this.mapping = mapping;
    this.defaultShard = defaultShard;
  }

  resolve(record: { [key: string]: unknown }): ShardId {
    const userId = record.userId as string | undefined;
    if (!userId) return this.defaultShard;

    for (const [shardId, prefixes] of this.mapping.entries()) {
      if (prefixes.some((prefix) => userId.startsWith(prefix))) {
        return shardId;
      }
    }

    return this.defaultShard;
  }
}

export class HashShardKey implements ShardKey {
  private shards: ShardId[];

  constructor(shards: ShardId[]) {
    this.shards = shards;
  }

  resolve(record: { [key: string]: unknown }): ShardId {
    const raw: string = JSON.stringify(record);
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i);
      hash |= 0;
    }
    const index = Math.abs(hash) % this.shards.length;
    return this.shards[index];
  }
}

export class RangeShardKey implements ShardKey {
  private ranges: { min: number; max: number; shardId: ShardId }[];
  private fallback: ShardId;

  constructor(ranges: { min: number; max: number; shardId: ShardId }[], fallback: ShardId) {
    this.ranges = ranges;
    this.fallback = fallback;
  }

  resolve(record: { [key: string]: unknown }): ShardId {
    const id = typeof record.id === 'string' ? parseInt(record.id, 10) : Math.floor(Math.random() * 100000);
    const range = this.ranges.find((r) => id >= r.min && id <= r.max);
    return range ? range.shardId : this.fallback;
  }
}

// ---------------------------------------------------------------------------
// High-level ShardingService
// ---------------------------------------------------------------------------

export class DatabaseShardingService {
  private static instance: DatabaseShardingService;

  private routers = new Map<string, ShardRouter>();
  private defaultShardKey: ShardKey | null = null;

  private constructor() {
    logger.info('Database Sharding service initialized');
  }

  static getInstance(): DatabaseShardingService {
    if (!DatabaseShardingService.instance) {
      DatabaseShardingService.instance = new DatabaseShardingService();
    }
    return DatabaseShardingService.instance;
  }

  /**
   * Initialize a named router.
   */
  initRouter(name: string, shardKey: ShardKey): ShardRouter {
    const router = new ShardRouter(shardKey);
    this.routers.set(name, router);
    return router;
  }

  /**
   * Get an initialized router.
   */
  getRouter(name: string): ShardRouter {
    const router = this.routers.get(name);
    if (!router) throw new Error(`Shard router "${name}" not initialized`);
    return router;
  }

  setDefaultShardKey(shardKey: ShardKey): void {
    this.defaultShardKey = shardKey;
  }

  /**
   * Health-check all routers.
   */
  async healthCheckAll(): Promise<Record<string, ShardHealth[]>> {
    const out: Record<string, ShardHealth[]> = {};
    for (const [name, router] of this.routers.entries()) {
      out[name] = await router.checkHealth();
    }
    return out;
  }

  /**
   * Disconnect all routers on shutdown.
   */
  async disconnectAll(): Promise<void> {
    for (const router of this.routers.values()) {
      await router.disconnect();
    }
  }
}

export const databaseSharding = DatabaseShardingService.getInstance();