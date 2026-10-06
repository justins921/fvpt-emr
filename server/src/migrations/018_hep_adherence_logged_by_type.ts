/**
 * Migration 018 — distinguish patient-logged vs staff-logged HEP adherence entries.
 *
 * Adds logged_by_type to hep_adherence_logs. Existing rows (all staff-logged,
 * since patients previously had no write path) backfill as 'staff' via the
 * column default.
 */
export async function up(client: any): Promise<void> {
  await client.query(`
    ALTER TABLE hep_adherence_logs
      ADD COLUMN IF NOT EXISTS logged_by_type VARCHAR(20) NOT NULL DEFAULT 'staff';
  `);
  await client.query(`
    ALTER TABLE hep_adherence_logs
      DROP CONSTRAINT IF EXISTS chk_hep_adherence_logged_by_type;
  `);
  await client.query(`
    ALTER TABLE hep_adherence_logs
      ADD CONSTRAINT chk_hep_adherence_logged_by_type
      CHECK (logged_by_type IN ('staff', 'patient'));
  `);
}

export async function down(client: any): Promise<void> {
  await client.query(`
    ALTER TABLE hep_adherence_logs
      DROP CONSTRAINT IF EXISTS chk_hep_adherence_logged_by_type;
  `);
  await client.query(`
    ALTER TABLE hep_adherence_logs
      DROP COLUMN IF EXISTS logged_by_type;
  `);
}
