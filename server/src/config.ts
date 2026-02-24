import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),

  // Database — supports Neon (POSTGRES_URL from Vercel marketplace) or local
  DATABASE_URL: z.string().default(
    process.env.POSTGRES_URL || 'postgresql://emr:emr_dev_password@localhost:5432/fvpt_emr'
  ),
  // Set to 'true' when using a managed Postgres with a trusted CA (Neon, AWS RDS, etc.)
  DATABASE_SSL_REJECT_UNAUTHORIZED: z.coerce.boolean().default(true),

  // JWT
  JWT_SECRET: z.string().min(32).default('dev-secret-change-in-production-minimum-32-chars!'),
  JWT_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),

  // Session
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().default(15),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().default(12),
  MAX_CONCURRENT_SESSIONS: z.coerce.number().default(5),

  // PHI encryption at rest (AES-256-GCM) — MUST be changed in production
  PHI_ENCRYPTION_KEY: z.string().min(32).default('dev-phi-encryption-key-change-in-production!!'),

  // File storage (serverless uses /tmp; local uses ./uploads)
  UPLOAD_DIR: z.string().default(process.env.VERCEL === '1' ? '/tmp/uploads' : './uploads'),
  MAX_FILE_SIZE_MB: z.coerce.number().default(25),
  ENCRYPT_ATTACHMENTS: z.coerce.boolean().default(true),

  // Cookie settings for refresh tokens
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z.coerce.boolean().default(process.env.NODE_ENV === 'production'),

  // Network security
  ALLOWED_ORIGINS: z.string().default(
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL},http://localhost:5173`
      : 'https://emr.local,http://localhost:5173'
  ),
  IP_ALLOWLIST: z.string().default(''), // empty = allow all
  TRUST_PROXY: z.coerce.boolean().default(process.env.VERCEL === '1' ? true : false),

  // SMS / Twilio (optional — messaging features degrade gracefully when not set)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // Data retention (days) — 0 = keep forever
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().default(2555), // ~7 years (HIPAA minimum)
  SESSION_CLEANUP_DAYS: z.coerce.number().default(90),

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

  // Warn about insecure defaults in production
  const cfg = result.data;
  if (cfg.NODE_ENV === 'production') {
    if (cfg.JWT_SECRET.includes('dev-secret')) {
      console.error('FATAL: JWT_SECRET must be changed from the default in production');
      process.exit(1);
    }
    if (cfg.PHI_ENCRYPTION_KEY.includes('dev-phi')) {
      console.error('FATAL: PHI_ENCRYPTION_KEY must be changed from the default in production');
      process.exit(1);
    }
  }

  return cfg;
}

export const config = loadConfig();
export type Config = z.infer<typeof envSchema>;
