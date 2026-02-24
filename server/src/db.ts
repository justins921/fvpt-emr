import { Pool, PoolClient } from 'pg';
import { config } from './config';

// In serverless (Vercel), use smaller pool and SSL for Neon/Vercel Postgres.
// In local/Docker, use larger pool without SSL requirement.
const isServerless = process.env.VERCEL === '1';
const needsSsl = config.DATABASE_URL.includes('neon.tech')
  || config.DATABASE_URL.includes('vercel-storage')
  || config.DATABASE_URL.includes('sslmode=require');

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: isServerless ? 3 : 20,
  idleTimeoutMillis: isServerless ? 10000 : 30000,
  connectionTimeoutMillis: 5000,
  ssl: needsSsl
    ? { rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED }
    : undefined,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error', err.message);
});

export async function query(text: string, params?: unknown[]) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (config.LOG_LEVEL === 'debug') {
    console.log('Query executed', { duration, rows: result.rowCount });
  }
  return result;
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Check database connectivity. Used by health check endpoint. */
export async function checkHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

export { pool };
