import { PoolClient } from 'pg';

export async function up(client: PoolClient): Promise<void> {
  // Per-user dashboard layout preferences (card visibility + ordering).
  // Absent row = all sections visible in default order.
  await client.query(`
    CREATE TABLE IF NOT EXISTS dashboard_preferences (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS dashboard_preferences`);
}
