import z from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(val => parseInt(val, 10)).default('3001'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_DIR: z.string().optional(),
  LOG_MAX_SIZE: z.string().default('20m'),
  LOG_MAX_FILES: z.string().default('14d'),
  ARENAX_ALLOWED_ORIGINS: z.string().optional(),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  HEALTH_CHECK_INTERVAL_MS: z.string().transform(val => parseInt(val, 10)).default('60000'),
  RATE_LIMIT_TRUSTED_IPS: z.string().optional(),
  RATE_LIMIT_TRUSTED_ACCOUNTS: z.string().optional(),
});

export const validateEnv = () => {
  try {
    const parsed = envSchema.parse(process.env);
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Environment validation failed:', error.format());
    }
    process.exit(1);
  }
};

export type Env = z.infer<typeof envSchema>;
