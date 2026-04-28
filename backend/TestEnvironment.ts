import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

/**
 * Managed Test Environment using TestContainers
 * Ensures clean database isolation for integration tests
 */
export class TestEnvironment {
  private pgContainer?: StartedPostgreSqlContainer;
  private redisContainer?: StartedRedisContainer;

  async start() {
    // Start PostgreSQL
    this.pgContainer = await new PostgreSqlContainer('postgres:15-alphine')
      .withDatabase('arenax_test')
      .withUsername('test_user')
      .withPassword('test_pass')
      .start();

    // Start Redis
    this.redisContainer = await new RedisContainer('redis:7-alpine').start();

    process.env.DATABASE_URL = this.pgContainer.getConnectionString();
    process.env.REDIS_URL = `redis://${this.redisContainer.getHost()}:${this.redisContainer.getMappedPort(6379)}`;
  }

  async stop() {
    await this.pgContainer?.stop();
    await this.redisContainer?.stop();
  }

  getPgConnection() {
    return this.pgContainer?.getConnectionString();
  }

  getRedisUrl() {
    return `redis://${this.redisContainer?.getHost()}:${this.redisContainer?.getMappedPort(6379)}`;
  }
}

export const testEnv = new TestEnvironment();