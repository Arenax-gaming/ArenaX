import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { logger } from '../services/logger.service';
import { metricsService } from '../services/metrics.service';

// Database connection pool configuration
const poolConfig = {
  // Minimum number of connections in the pool
  min: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
  
  // Maximum number of connections in the pool
  max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
  
  // Time (in seconds) to wait for a connection from the pool
  connectionTimeout: parseInt(process.env.DATABASE_POOL_TIMEOUT || '30', 10),
  
  // Time (in seconds) before idle connections are closed
  idleTimeout: parseInt(process.env.DATABASE_IDLE_TIMEOUT || '600', 10),
};

// Create Prisma client with connection pooling
// Note: Prisma uses pg-pool internally for PostgreSQL
// Connection pooling is configured via the DATABASE_URL connection string parameters
// Example: postgresql://user:password@host:port/database?pool_min=2&pool_max=10
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'error', 'warn'] 
    : ['error'],
});

// Connection pool monitoring
let connectionCount = 0;

prisma.$use(async (params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => Promise<any>) => {
  const before = Date.now();
  connectionCount++;

  const model = params.model ?? 'unknown';
  const action = params.action;

  try {
    const result = await next(params);
    const durationMs = Date.now() - before;
    const durationSec = durationMs / 1000;

    metricsService.recordDbQuery(action, model, durationSec, 'success');

    if (process.env.NODE_ENV === 'development') {
      logger.debug('DB query', { model, action, durationMs });
    }

    if (durationMs > 500) {
      logger.warn('Slow DB query detected', { model, action, durationMs });
    }

    return result;
  } catch (err) {
    const durationMs = Date.now() - before;
    metricsService.recordDbQuery(action, model, durationMs / 1000, 'error');
    logger.error('DB query failed', { model, action, durationMs, error: err });
    throw err;
  } finally {
    connectionCount--;
  }
});

// Health check function
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('Database health check failed', { error });
    return false;
  }
}

// Get connection pool statistics
export function getConnectionStats() {
  return {
    activeConnections: connectionCount,
    poolConfig,
  };
}

// Graceful shutdown
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database connection closed');
}

export default prisma;
