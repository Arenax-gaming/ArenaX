import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

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
  
  try {
    const result = await next(params);
    const after = Date.now();
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`Query: ${params.model}.${params.action} took ${after - before}ms`);
    }
    
    return result;
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
    console.error('Database health check failed:', error);
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
  console.log('Database connection closed');
}

export default prisma;
