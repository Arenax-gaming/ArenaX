import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { logger } from '../services/logger.service';
import { metricsService } from '../services/metrics.service';
import { getEnv } from './env';
import { getCorrelationId } from '../services/correlation.service';

// PgBouncer configuration
const PGBOUNCER_ENABLED = process.env.PGBOUNCER_ENABLED === 'true';

// Database connection pool configuration — read from the validated env singleton.
const buildPoolConfig = () => {
    try {
        const env = getEnv();
        return {
            min: env.DATABASE_POOL_MIN,
            max: env.DATABASE_POOL_MAX,
            connectionTimeout: env.DATABASE_POOL_TIMEOUT,
            idleTimeout: env.DATABASE_IDLE_TIMEOUT,
        };
    } catch {
        // Fallback for contexts where initEnv() hasn't run yet (e.g. Prisma CLI).
        return {
            min: parseInt(process.env.DATABASE_POOL_MIN ?? '2', 10),
            max: parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10),
            connectionTimeout: parseInt(process.env.DATABASE_POOL_TIMEOUT ?? '30', 10),
            idleTimeout: parseInt(process.env.DATABASE_IDLE_TIMEOUT ?? '600', 10),
        };
    }
};

const poolConfig = buildPoolConfig();

// Determine which database URL to use (PgBouncer or direct)
const getDatabaseUrl = () => {
    if (PGBOUNCER_ENABLED && process.env.DATABASE_URL) {
        logger.info('Using PgBouncer connection pooler');
        return process.env.DATABASE_URL;
    }
    // Fallback to direct connection or DATABASE_DIRECT_URL
    return process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
};

// Create Prisma client with connection pooling
// Note: Prisma uses pg-pool internally for PostgreSQL
// Connection pooling is configured via the DATABASE_URL connection string parameters
// Example: postgresql://user:password@host:port/database?pool_min=2&pool_max=10
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
  log: (() => {
    try {
        return getEnv().isDevelopment ? ['query', 'error', 'warn'] : ['error'];
    } catch {
        return process.env.NODE_ENV === 'development'
            ? ['query', 'error', 'warn']
            : ['error'];
    }
  })() as Prisma.LogLevel[],
});

// Connection pool monitoring
let connectionCount = 0;

prisma.$use(async (params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => Promise<any>) => {
  const before = Date.now();
  connectionCount++;

  // Decorate raw queries with a correlation_id comment for cross-DB auditing.
  // e.g. SELECT 1 /* correlation_id: abc-123 */
  const correlationId = getCorrelationId();
  if (correlationId && params.args && typeof params.args === 'object' && 'query' in params.args && typeof params.args.query === 'string') {
    params.args.query = `${params.args.query} /* correlation_id: ${correlationId} */`;
  }

  const model = params.model ?? 'unknown';
  const action = params.action;

  try {
    const result = await next(params);
    const durationMs = Date.now() - before;
    const durationSec = durationMs / 1000;

    metricsService.recordDbQuery(action, model, durationSec, 'success');

    if (process.env.NODE_ENV === 'development' || (() => { try { return getEnv().isDevelopment; } catch { return false; } })()) {
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
    pgbouncerEnabled: PGBOUNCER_ENABLED,
  };
}

// PgBouncer monitoring function
export async function getPgBouncerStats(): Promise<any> {
  if (!PGBOUNCER_ENABLED) {
    return null;
  }

  try {
    // Query PgBouncer's built-in statistics view
    const stats = await prisma.$queryRaw`
      SELECT 
        pool_mode,
        cl_active,
        cl_waiting,
        sv_active,
        sv_idle,
        sv_used,
        sv_tested,
        sv_login,
        maxwait,
        maxwait_us
      FROM pgbouncer_stats
    `;
    return stats;
  } catch (error) {
    logger.warn('Failed to fetch PgBouncer stats', { error });
    return null;
  }
}

// Graceful shutdown
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database connection closed');
}

export default prisma;
