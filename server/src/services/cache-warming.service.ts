import { logger } from './logger.service';
import { cdnCacheService } from './cdn-cache.service';
import { getEnv } from '../config/env';

interface WarmingEndpoint {
  path: string;
  ttl?: number;
  tags?: string[];
  priority: 'high' | 'medium' | 'low';
}

export class CacheWarmingService {
  private endpoints: WarmingEndpoint[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private warmingStats = { total: 0, success: 0, failed: 0 };

  registerEndpoint(endpoint: WarmingEndpoint): void {
    this.endpoints.push(endpoint);
    logger.info('Cache warming endpoint registered', { path: endpoint.path, priority: endpoint.priority });
  }

  registerEndpoints(endpoints: WarmingEndpoint[]): void {
    endpoints.forEach(e => this.registerEndpoint(e));
  }

  start(intervalMs = 300000): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.warmAll();
    this.interval = setInterval(() => this.warmAll(), intervalMs);
    this.interval.unref();

    logger.info('Cache warming service started', { intervalMs });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    logger.info('Cache warming service stopped');
  }

  async warmAll(): Promise<void> {
    if (this.endpoints.length === 0) return;

    const sorted = [...this.endpoints].sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    for (const endpoint of sorted) {
      await this.warmEndpoint(endpoint);
    }
  }

  private async warmEndpoint(endpoint: WarmingEndpoint): Promise<void> {
    const env = getEnv();
    const url = `${env.BACKEND_URL}${endpoint.path}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'x-cache-warming': 'true' },
      });

      this.warmingStats.total++;

      if (response.ok) {
        this.warmingStats.success++;
        cdnCacheService.queueForWarming(endpoint.path);
        logger.debug('Cache warmed', { path: endpoint.path, status: response.status });
      } else {
        this.warmingStats.failed++;
        logger.warn('Cache warming failed', { path: endpoint.path, status: response.status });
      }
    } catch (error) {
      this.warmingStats.failed++;
      this.warmingStats.total++;
      logger.error('Cache warming error', { path: endpoint.path, error });
    }
  }

  getStats() {
    return { ...this.warmingStats, endpointsRegistered: this.endpoints.length, isRunning: this.isRunning };
  }

  getEndpoints(): WarmingEndpoint[] {
    return [...this.endpoints];
  }
}

export const cacheWarmingService = new CacheWarmingService();
