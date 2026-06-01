import { Request, Response, NextFunction } from 'express';
import { metricsService } from '../services/metrics.service';
import { logger } from '../services/logger.service';

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // Track active connections
  metricsService.incrementActiveConnections();

  // Hook into response finish to record metrics
  res.on('finish', () => {
    const duration = (Date.now() - startTime) / 1000; // Convert to seconds
    const route = req.route?.path || req.path || 'unknown';
    const method = req.method;
    const statusCode = res.statusCode;

    try {
      metricsService.recordHttpRequest(method, route, statusCode, duration);
      
      // Record response size if available
      const contentLength = res.get('content-length');
      if (contentLength) {
        metricsService.recordResponseSize(route, parseInt(contentLength, 10));
      }

      // Log slow requests
      if (duration > 5) {
        logger.warn('Slow request detected', {
          method,
          route,
          statusCode,
          duration,
          ip: req.ip,
        });
      }
    } catch (error) {
      logger.error('Error recording metrics', { error });
    } finally {
      metricsService.decrementActiveConnections();
    }
  });

  next();
};
