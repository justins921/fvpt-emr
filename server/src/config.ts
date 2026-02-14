import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),

  // Database — supports Vercel Postgres (POSTGRES_URL), Neon, or local
  DATABASE_URL: z.string().default(
    process.env.POSTGRES_URL || 'postgresql://emr:emr_dev_password@localhost:5432/fvpt_emr'
  ),

  // JWT
  JWT_SECRET: z.string().min(32).default('dev-secret-change-in-production-minimum-32-chars!'),
  JWT_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),

  // Session
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().default(15),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().default(12),

  // File storage (serverless uses /tmp; local uses ./uploads)
  UPLOAD_DIR: z.string().default(process.env.VERCEL === '1' ? '/tmp/uploads' : './uploads'),
  MAX_FILE_SIZE_MB: z.coerce.number().default(25),
  ATTACHMENT_ENCRYPTION_KEY: z.string().optional(),

  // Network security
  ALLOWED_ORIGINS: z.string().default(
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL},http://localhost:5173`
      : 'https://emr.local,http://localhost:5173'
  ),
  IP_ALLOWLIST: z.string().default(''), // empty = allow all
  TRUST_PROXY: z.coerce.boolean().default(process.env.VERCEL === '1' ? true : false),

  // Logging (NO PHI in logs)
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
export type Config = z.infer<typeof envSchema>;
