import { pool } from '../db';

async function run() {
  const direction = process.argv[2] || 'up';
  const client = await pool.connect();

  try {
    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrations = [
      { name: '001_initial_schema', module: await import('./001_initial_schema') },
      { name: '002_add_credential_to_users', module: await import('./002_add_credential_to_users') },
      { name: '003_email_to_username', module: await import('./003_email_to_username') },
      { name: '004_add_dev_role_and_support', module: await import('./004_add_dev_role_and_support') },
      { name: '005_add_messaging', module: await import('./005_add_messaging') },
      { name: '006_add_all_features', module: await import('./006_add_all_features') },
      { name: '007_security_hardening', module: await import('./007_security_hardening') },
      { name: '008_seed_exercises_and_features', module: await import('./008_seed_exercises_and_features') },
      { name: '009_fix_hep_schema', module: await import('./009_fix_hep_schema') },
    ];

    if (direction === 'up') {
      for (const migration of migrations) {
        const { rows } = await client.query(
          'SELECT 1 FROM _migrations WHERE name = $1',
          [migration.name]
        );
        if (rows.length === 0) {
          console.log(`Running migration: ${migration.name}`);
          await client.query('BEGIN');
          await migration.module.up(client);
          await client.query(
            'INSERT INTO _migrations (name) VALUES ($1)',
            [migration.name]
          );
          await client.query('COMMIT');
          console.log(`Completed: ${migration.name}`);
        } else {
          console.log(`Skipping (already applied): ${migration.name}`);
        }
      }
    } else if (direction === 'down') {
      for (const migration of [...migrations].reverse()) {
        const { rows } = await client.query(
          'SELECT 1 FROM _migrations WHERE name = $1',
          [migration.name]
        );
        if (rows.length > 0) {
          console.log(`Reverting migration: ${migration.name}`);
          await client.query('BEGIN');
          await migration.module.down(client);
          await client.query(
            'DELETE FROM _migrations WHERE name = $1',
            [migration.name]
          );
          await client.query('COMMIT');
          console.log(`Reverted: ${migration.name}`);
        }
      }
    }

    console.log('Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
