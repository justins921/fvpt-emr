import { PoolClient } from 'pg';

export async function up(client: PoolClient): Promise<void> {
  // Soft-delete support for HEP programs/templates (previously only hard-delete of items existed)
  await client.query(`
    ALTER TABLE exercise_programs
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_exercise_programs_active
    ON exercise_programs(clinic_id, is_active)
  `);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP INDEX IF EXISTS idx_exercise_programs_active`);
  await client.query(`ALTER TABLE exercise_programs DROP COLUMN IF EXISTS is_active`);
}
