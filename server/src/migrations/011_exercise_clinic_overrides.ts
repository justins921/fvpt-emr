import { PoolClient } from 'pg';

/**
 * Migration 011 — Per-clinic exercise overrides.
 * Lets a clinic rename/re-image/re-describe global exercises without
 * modifying the shared global rows.
 */

export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS exercise_clinic_overrides (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
      custom_name VARCHAR(255),
      custom_description TEXT,
      custom_instructions TEXT,
      custom_image_url TEXT,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(clinic_id, exercise_id)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_exercise_overrides_clinic ON exercise_clinic_overrides(clinic_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_exercise_overrides_exercise ON exercise_clinic_overrides(exercise_id);`);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS exercise_clinic_overrides CASCADE;`);
}
