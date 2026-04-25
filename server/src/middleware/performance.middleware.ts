import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.service';

interface PerformanceMetrics {
  [endpoint: string]: {
    count: number;
    totalTime: number;
    avgTime: number;
    minTime: number;
    maxTime: number;
  };
}

const metrics: PerformanceMetrics = {};

/**
 * Performance monitoring middleware
 * Tracks response times and logs slow requests
 */
export const performanceMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const start = Date.now();
  const endpoint = `${req.method} ${req.path}`;

  // Override end to capture response time
  const originalEnd = res.end;
  
  // @ts-ignore - Overriding Express Response method
  res.end = function(this: any, ...args: any[]): any {
    const duration = Date.now() - start;
    
    // Update metrics
    if (!metrics[endpoint]) {
      metrics[endpoint] = {
        count: 0,
        totalTime: 0,
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
      };
    }

    const metric = metrics[endpoint];
    metric.count++;
    metric.totalTime += duration;
    metric.avgTime = metric.totalTime / metric.count;
    metric.minTime = Math.min(metric.minTime, duration);
    metric.maxTime = Math.max(metric.maxTime, duration);

    // Log slow requests (>1000ms)
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        endpoint,
        duration,
        statusCode: res.statusCode,
      });
    }

    // Add response time header
    res.setHeader('X-Response-Time', `${duration}ms`);

    // @ts-ignore - Calling original Express method
    return originalEnd.apply(res, args);
  };

  next();
};

/**
 * Get performance metrics
 */
export function getPerformanceMetrics(): PerformanceMetrics {
  return metrics;
}

/**
 * Reset performance metrics
 */
export function resetPerformanceMetrics(): void {
  Object.keys(metrics).forEach(key => delete metrics[key]);
}
