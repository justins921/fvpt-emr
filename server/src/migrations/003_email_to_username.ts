import { PoolClient } from 'pg';

export async function up(client: PoolClient): Promise<void> {
  // Rename email to username — clinics use simple usernames, not email addresses
  await client.query(`ALTER TABLE users RENAME COLUMN email TO username`);
  await client.query(`DROP INDEX IF EXISTS idx_users_email`);
  await client.query(`CREATE INDEX idx_users_username ON users(username)`);
  // Relax the constraint — usernames are just short strings, not emails
  await client.query(`ALTER TABLE users ALTER COLUMN username TYPE VARCHAR(100)`);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`ALTER TABLE users ALTER COLUMN username TYPE VARCHAR(255)`);
  await client.query(`DROP INDEX IF EXISTS idx_users_username`);
  await client.query(`CREATE INDEX idx_users_email ON users(username)`);
  await client.query(`ALTER TABLE users RENAME COLUMN username TO email`);
}
