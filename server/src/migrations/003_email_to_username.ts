import { PoolClient } from 'pg';

export async function up(client: PoolClient): Promise<void> {
  // Check if the column is still called 'email' (existing DBs) vs already 'username' (fresh installs)
  const col = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email'`
  );
  if (col.rows.length > 0) {
    await client.query(`ALTER TABLE users RENAME COLUMN email TO username`);
    await client.query(`ALTER TABLE users ALTER COLUMN username TYPE VARCHAR(100)`);
  }
  await client.query(`DROP INDEX IF EXISTS idx_users_email`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`ALTER TABLE users ALTER COLUMN username TYPE VARCHAR(255)`);
  await client.query(`DROP INDEX IF EXISTS idx_users_username`);
  await client.query(`CREATE INDEX idx_users_email ON users(username)`);
  await client.query(`ALTER TABLE users RENAME COLUMN username TO email`);
}
