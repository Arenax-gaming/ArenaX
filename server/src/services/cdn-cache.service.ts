import { logger } from './logger.service';
import { getEnv } from '../config/env';

export type CdnProvider = 'cloudflare' | 'cloudfront' | 'fastly';

export interface CdnCacheConfig {
  provider: CdnProvider;
  zoneId?: string;
  apiToken?: string;
  distributionId?: string;
  baseUrl: string;
  defaultTtl: number;
  staleWhileRevalidate: number;
}

export interface CacheTag {
  type: 'user' | 'endpoint' | 'entity';
  value: string;
}

export interface CacheAnalytics {
  timestamp: number;
  hitRate: number;
  totalRequests: number;
  hits: number;
  misses: number;
  bandwidthSaved: number;
  purgeCount: number;
}

export class CdnCacheService {
  private config: CdnCacheConfig;
  private hits = 0;
  private misses = 0;
  private totalRequests = 0;
  private purgeCount = 0;
  private purgeHistory: Array<{ pattern: string; timestamp: number; reason: string }> = [];
  private warmingQueue: Set<string> = new Set();
  private warmingInProgress = false;

  constructor(config: CdnCacheConfig) {
    this.config = config;
    logger.info('CDN Cache service initialized', { provider: config.provider });
  }

  getConfig(): CdnCacheConfig {
    return { ...this.config };
  }

  generateCacheTags(...tags: CacheTag[]): string[] {
    return tags.map(t => `${t.type}:${t.value}`);
  }

  buildCacheControlHeaders(ttl?: number): Record<string, string> {
    const maxAge = ttl ?? this.config.defaultTtl;
    return {
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${this.config.staleWhileRevalidate}`,
      'CDN-Cache-Control': `public, max-age=${maxAge}`,
      'Surrogate-Control': `public, max-age=${maxAge}`,
    };
  }

  buildCacheKey(parts: string[]): string {
    return parts.filter(Boolean).join(':');
  }

  async purgeByTag(tag: string, reason: string): Promise<boolean> {
    try {
      this.purgeCount++;
      this.purgeHistory.push({ pattern: tag, timestamp: Date.now(), reason });
      logger.info('Cache purge by tag', { tag, reason });
      return true;
    } catch (error) {
      logger.error('Cache purge failed', { tag, error });
      return false;
    }
  }

  async purgeByPattern(pattern: string, reason: string): Promise<boolean> {
    try {
      this.purgeCount++;
      this.purgeHistory.push({ pattern, timestamp: Date.now(), reason });
      logger.info('Cache purge by pattern', { pattern, reason });
      return true;
    } catch (error) {
      logger.error('Cache purge by pattern failed', { pattern, error });
      return false;
    }
  }

  async purgeAll(reason: string): Promise<boolean> {
    try {
      this.purgeCount++;
      this.purgeHistory.push({ pattern: '*', timestamp: Date.now(), reason });
      logger.info('Cache full purge', { reason });
      return true;
    } catch (error) {
      logger.error('Cache full purge failed', { error });
      return false;
    }
  }

  recordHit(): void {
    this.hits++;
    this.totalRequests++;
  }

  recordMiss(): void {
    this.misses++;
    this.totalRequests++;
  }

  getAnalytics(): CacheAnalytics {
    const total = this.hits + this.misses;
    return {
      timestamp: Date.now(),
      hitRate: total > 0 ? this.hits / total : 0,
      totalRequests: this.totalRequests,
      hits: this.hits,
      misses: this.misses,
      bandwidthSaved: this.hits * 51200,
      purgeCount: this.purgeCount,
    };
  }

  getPurgeHistory(): Array<{ pattern: string; timestamp: number; reason: string }> {
    return [...this.purgeHistory];
  }

  queueForWarming(key: string): void {
    this.warmingQueue.add(key);
    this.processWarmingQueue();
  }

  private async processWarmingQueue(): Promise<void> {
    if (this.warmingInProgress || this.warmingQueue.size === 0) return;
    this.warmingInProgress = true;

    const batch = Array.from(this.warmingQueue).slice(0, 10);
    this.warmingQueue = new Set(Array.from(this.warmingQueue).slice(10));

    try {
      await Promise.allSettled(
        batch.map(key => this.warmSingleKey(key))
      );
    } finally {
      this.warmingInProgress = false;
      if (this.warmingQueue.size > 0) {
        setImmediate(() => this.processWarmingQueue());
      }
    }
  }

  private async warmSingleKey(key: string): Promise<void> {
    try {
      const url = `${this.config.baseUrl}${key}`;
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        logger.debug('Cache warming success', { key, status: response.status });
      }
    } catch (error) {
      logger.debug('Cache warming failed', { key, error });
    }
  }

  getWarmingQueueSize(): number {
    return this.warmingQueue.size;
  }

  isWarmingInProgress(): boolean {
    return this.warmingInProgress;
  }
}

const resolveCdnConfig = () => {
  try {
    const env = getEnv();
    return {
      provider: env.CDN_PROVIDER as CdnProvider ?? 'cloudflare',
      zoneId: env.CDN_ZONE_ID,
      apiToken: env.CDN_API_TOKEN,
      distributionId: env.CDN_DISTRIBUTION_ID,
      baseUrl: env.BACKEND_URL,
      defaultTtl: Number(env.CDN_DEFAULT_TTL ?? 86400),
      staleWhileRevalidate: Number(env.CDN_STALE_WHILE_REVALIDATE ?? 86400),
    };
  } catch {
    return {
      provider: 'cloudflare' as CdnProvider,
      zoneId: process.env.CDN_ZONE_ID,
      apiToken: process.env.CDN_API_TOKEN,
      distributionId: process.env.CDN_DISTRIBUTION_ID,
      baseUrl: process.env.BACKEND_URL ?? 'http://localhost:3001',
      defaultTtl: Number(process.env.CDN_DEFAULT_TTL ?? 86400),
      staleWhileRevalidate: Number(process.env.CDN_STALE_WHILE_REVALIDATE ?? 86400),
    };
  }
};

export const cdnCacheService = new CdnCacheService(resolveCdnConfig());
