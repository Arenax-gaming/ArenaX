import { logger } from './logger.service';
import { cdnCacheService, CacheAnalytics } from './cdn-cache.service';

interface AnalyticsRecord {
  timestamp: number;
  hitRate: number;
  totalRequests: number;
  hits: number;
  misses: number;
  purgeCount: number;
}

export class CacheAnalyticsService {
  private history: AnalyticsRecord[] = [];
  private maxHistorySize = 10080;
  private interval: ReturnType<typeof setInterval> | null = null;

  start(intervalMs = 60000): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.snapshot(), intervalMs);
    this.interval.unref();
    logger.info('Cache analytics service started', { intervalMs });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private snapshot(): void {
    const analytics = cdnCacheService.getAnalytics();
    this.history.push({
      timestamp: analytics.timestamp,
      hitRate: analytics.hitRate,
      totalRequests: analytics.totalRequests,
      hits: analytics.hits,
      misses: analytics.misses,
      purgeCount: analytics.purgeCount,
    });

    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
  }

  getCurrentAnalytics(): CacheAnalytics {
    return cdnCacheService.getAnalytics();
  }

  getHistory(hours = 24): AnalyticsRecord[] {
    const cutoff = Date.now() - hours * 3600000;
    return this.history.filter(r => r.timestamp >= cutoff);
  }

  getSummary(hours = 24): {
    averageHitRate: number;
    totalRequests: number;
    totalPurges: number;
    currentHitRate: number;
  } {
    const recent = this.getHistory(hours);
    const totalRequests = recent.reduce((s, r) => s + r.totalRequests, 0);
    const totalHits = recent.reduce((s, r) => s + r.hits, 0);

    return {
      averageHitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
      totalRequests,
      totalPurges: recent.reduce((s, r) => s + r.purgeCount, 0),
      currentHitRate: cdnCacheService.getAnalytics().hitRate,
    };
  }
}

export const cacheAnalyticsService = new CacheAnalyticsService();
