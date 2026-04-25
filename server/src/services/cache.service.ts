import { logger } from './logger.service';

/**
 * In-memory cache implementation
 * Can be replaced with Redis in production
 */
interface CacheEntry {
  value: any;
  expiry: number;
}

export class CacheService {
  private cache: Map<string, CacheEntry> = new Map();
  private defaultTTL: number;

  constructor(defaultTTL: number = 300) { // 5 minutes default
    this.defaultTTL = defaultTTL;
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const entry = this.cache.get(key);
      
      if (!entry) {
        return null;
      }

      // Check if expired
      if (Date.now() > entry.expiry) {
        this.cache.delete(key);
        return null;
      }

      return entry.value as T;
    } catch (error) {
      logger.error('Cache get error', { error, key });
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const expiry = Date.now() + (ttl || this.defaultTTL) * 1000;
      this.cache.set(key, { value, expiry });
    } catch (error) {
      logger.error('Cache set error', { error, key });
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string): Promise<void> {
    try {
      this.cache.delete(key);
    } catch (error) {
      logger.error('Cache delete error', { error, key });
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    try {
      this.cache.clear();
    } catch (error) {
      logger.error('Cache clear error', { error });
    }
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Check if key exists and is not expired
   */
  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  /**
   * Get or set with callback
   */
  async getOrSet<T>(
    key: string,
    callback: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    
    if (cached !== null) {
      return cached;
    }

    const value = await callback();
    await this.set(key, value, ttl);
    
    return value;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; entries: number } {
    return {
      size: this.cache.size,
      entries: this.cache.size,
    };
  }
}

export const cacheService = new CacheService();
