import { PoolClient } from 'pg';

/**
 * Migration 009 — Fix HEP schema mismatches between routes and DB tables.
 *
 * The HEP routes reference columns that were never created in migration 006:
 *   - exercises: default_duration_minutes, tags
 *   - exercise_programs: duration_weeks, notes, sent_at, source_template_id
 *   - exercise_program_items: duration_minutes, resistance
 *   - hep_adherence_logs: completed_at, completion_percent, difficulty_rating,
 *                          exercises_completed (as UUID[]), logged_by
 */

export async function up(client: PoolClient): Promise<void> {
  // ── 1. exercises — add missing columns ──
  await client.query(`
    ALTER TABLE exercises
      ADD COLUMN IF NOT EXISTS default_duration_minutes INT,
      ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
  `);

  // ── 2. exercise_programs — add missing columns ──
  await client.query(`
    ALTER TABLE exercise_programs
      ADD COLUMN IF NOT EXISTS duration_weeks INT,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS source_template_id UUID REFERENCES exercise_programs(id) ON DELETE SET NULL;
  `);

  // ── 3. exercise_program_items — add missing columns ──
  await client.query(`
    ALTER TABLE exercise_program_items
      ADD COLUMN IF NOT EXISTS duration_minutes INT,
      ADD COLUMN IF NOT EXISTS resistance VARCHAR(100);
  `);

  // ── 4. hep_adherence_logs — add missing columns ──
  // The route expects completed_at (TIMESTAMPTZ), completion_percent, difficulty_rating,
  // exercises_completed as UUID[], and logged_by.
  // The existing schema has completed_date (DATE), exercises_completed (INT), exercises_total (INT).
  // We add the new columns alongside the old ones for backwards compatibility.
  await client.query(`
    ALTER TABLE hep_adherence_logs
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS completion_percent INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS difficulty_rating VARCHAR(20),
      ADD COLUMN IF NOT EXISTS logged_by UUID REFERENCES users(id);
  `);

  // Rename the INT exercises_completed to exercises_completed_count to avoid conflict,
  // then add the UUID[] column expected by routes.
  // Only rename if the column type is integer (not already UUID[]).
  const colCheck = await client.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'hep_adherence_logs' AND column_name = 'exercises_completed'
  `);

  if (colCheck.rows.length > 0 && colCheck.rows[0].data_type === 'integer') {
    await client.query(`ALTER TABLE hep_adherence_logs RENAME COLUMN exercises_completed TO exercises_completed_count;`);
    await client.query(`ALTER TABLE hep_adherence_logs ADD COLUMN exercises_completed UUID[] NOT NULL DEFAULT '{}';`);
  }

  console.log('Migration 009: Fixed HEP schema mismatches');
}

export async function down(client: PoolClient): Promise<void> {
  // Reverse: remove added columns
  await client.query(`ALTER TABLE exercises DROP COLUMN IF EXISTS default_duration_minutes;`);
  await client.query(`ALTER TABLE exercises DROP COLUMN IF EXISTS tags;`);

  await client.query(`ALTER TABLE exercise_programs DROP COLUMN IF EXISTS duration_weeks;`);
  await client.query(`ALTER TABLE exercise_programs DROP COLUMN IF EXISTS notes;`);
  await client.query(`ALTER TABLE exercise_programs DROP COLUMN IF EXISTS sent_at;`);
  await client.query(`ALTER TABLE exercise_programs DROP COLUMN IF EXISTS source_template_id;`);

  await client.query(`ALTER TABLE exercise_program_items DROP COLUMN IF EXISTS duration_minutes;`);
  await client.query(`ALTER TABLE exercise_program_items DROP COLUMN IF EXISTS resistance;`);

  await client.query(`ALTER TABLE hep_adherence_logs DROP COLUMN IF EXISTS completed_at;`);
  await client.query(`ALTER TABLE hep_adherence_logs DROP COLUMN IF EXISTS completion_percent;`);
  await client.query(`ALTER TABLE hep_adherence_logs DROP COLUMN IF EXISTS difficulty_rating;`);
  await client.query(`ALTER TABLE hep_adherence_logs DROP COLUMN IF EXISTS logged_by;`);
  await client.query(`ALTER TABLE hep_adherence_logs DROP COLUMN IF EXISTS exercises_completed;`);

  // Restore original column name
  const colCheck = await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hep_adherence_logs' AND column_name = 'exercises_completed_count'
  `);
  if (colCheck.rows.length > 0) {
    await client.query(`ALTER TABLE hep_adherence_logs RENAME COLUMN exercises_completed_count TO exercises_completed;`);
  }
}
