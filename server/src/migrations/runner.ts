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
      { name: '010_add_note_templates', module: await import('./010_add_note_templates') },
      { name: '011_exercise_clinic_overrides', module: await import('./011_exercise_clinic_overrides') },
      { name: '012_backfill_exercise_images', module: await import('./012_backfill_exercise_images') },
      { name: '013_preauth_billing', module: await import('./013_preauth_billing') },
      { name: '014_patient_notes', module: await import('./014_patient_notes') },
      { name: '015_communication_consent', module: await import('./015_communication_consent') },
      { name: '016_hep_template_soft_delete', module: await import('./016_hep_template_soft_delete') },
      { name: '017_dashboard_preferences', module: await import('./017_dashboard_preferences') },
      { name: '018_hep_adherence_logged_by_type', module: await import('./018_hep_adherence_logged_by_type') },
      { name: '019_user_invites', module: await import('./019_user_invites') },
      { name: '020_underpayment_detection', module: await import('./020_underpayment_detection') },
      { name: '021_denial_patterns', module: await import('./021_denial_patterns') },
      { name: '022_code_reviews', module: await import('./022_code_reviews') },
      { name: '023_appeal_drafts', module: await import('./023_appeal_drafts') },
      { name: '024_online_booking', module: await import('./024_online_booking') },
      { name: '025_portal_expansion', module: await import('./025_portal_expansion') },
      { name: '026_booking_timezone', module: await import('./026_booking_timezone') },
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
