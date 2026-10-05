import { PoolClient } from 'pg';

/**
 * Migration 014 — Internal patient notes.
 *
 * New table `patient_notes`: staff-only notes pinned to a patient's chart
 * (scheduling preferences, billing contacts, alerts). These are NOT part of
 * the legal clinical record — they never appear in note exports, packets,
 * or patient-facing views (portal). Soft-delete only via is_active.
 */

export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS patient_notes (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      author_id UUID NOT NULL REFERENCES users(id),
      note_text TEXT NOT NULL,
      category VARCHAR(50) NOT NULL DEFAULT 'general'
        CHECK (category IN ('scheduling', 'billing', 'clinical_alert', 'general')),
      is_pinned BOOLEAN NOT NULL DEFAULT false,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_patient_notes_patient ON patient_notes(patient_id, is_active);`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_patient_notes_clinic ON patient_notes(clinic_id);`
  );
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS patient_notes;`);
}
