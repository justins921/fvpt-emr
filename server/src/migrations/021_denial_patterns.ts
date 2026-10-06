import { PoolClient } from 'pg';

/**
 * Migration 021 — Denial pattern mining (AI billing Phase 2).
 *
 * Learns denial patterns from ERA (835) history: for each payer + CPT +
 * diagnosis + reason-code combination, tracks how often lines are denied.
 * Powers pre-submission claim risk scoring.
 *
 * ── CROSS-CLINIC LEARNING DESIGN (future) ──────────────────────────────────
 * The `scope` column prepares for aggregate learning across clinics WITHOUT
 * any clinic seeing another clinic's data:
 *   - scope='clinic' (default): rows belong to one clinic (clinic_id NOT NULL).
 *     This is all that exists today; learning writes only these rows.
 *   - scope='global': aggregate rows (clinic_id NULL) produced by a FUTURE
 *     rollup job from clinics that opted in via the
 *     `contribute_anonymized_patterns` clinic setting.
 *
 * PRIVACY RULE (binding on any future rollup job):
 *   - Global rows may contain ONLY: payer_name, cpt_code, diagnosis_code,
 *     reason_code, counts, rates, contributing_clinics.
 *   - NEVER: clinic IDs, patient data, claim numbers, dates, or anything
 *     traceable to a clinic or patient.
 *   - Only publish a global row when total_lines >= 50 AND
 *     contributing_clinics >= 3 (k-anonymity: no single clinic identifiable).
 *   - The rollup job is NOT built in this migration (see the hook comment in
 *     server/src/services/denialPatterns.ts).
 *
 * Diagnosis sentinel: diagnosis_code = '' means "any diagnosis" (a pattern
 * aggregated across diagnoses). '' is used instead of NULL because Postgres
 * treats NULLs as distinct in UNIQUE constraints, which would allow
 * duplicate logical rows.
 */
export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS denial_patterns (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      scope VARCHAR(10) NOT NULL DEFAULT 'clinic'
        CHECK (scope IN ('clinic', 'global')),
      clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
      payer_name VARCHAR(255) NOT NULL,
      cpt_code VARCHAR(20) NOT NULL,
      diagnosis_code VARCHAR(20) NOT NULL DEFAULT '',
      reason_code VARCHAR(20) NOT NULL,
      total_lines INTEGER NOT NULL DEFAULT 0 CHECK (total_lines >= 0),
      denied_lines INTEGER NOT NULL DEFAULT 0 CHECK (denied_lines >= 0),
      denial_rate DECIMAL(5,4) NOT NULL DEFAULT 0
        CHECK (denial_rate >= 0 AND denial_rate <= 1),
      contributing_clinics INTEGER NOT NULL DEFAULT 1 CHECK (contributing_clinics >= 1),
      last_seen_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (scope = 'clinic' AND clinic_id IS NOT NULL) OR
        (scope = 'global' AND clinic_id IS NULL)
      )
    )
  `);

  // Partial unique indexes: Postgres treats NULL as distinct in UNIQUE
  // constraints, so a single UNIQUE(scope, clinic_id, ...) would NOT prevent
  // duplicate global rows (clinic_id IS NULL). Two partial indexes enforce
  // uniqueness correctly for each scope.
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_denial_patterns_clinic
    ON denial_patterns (clinic_id, payer_name, cpt_code, diagnosis_code, reason_code)
    WHERE scope = 'clinic'
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_denial_patterns_global
    ON denial_patterns (payer_name, cpt_code, diagnosis_code, reason_code)
    WHERE scope = 'global'
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_denial_patterns_lookup
    ON denial_patterns (scope, clinic_id, payer_name, cpt_code, diagnosis_code, denial_rate DESC)
  `);

  // Key/value clinic settings store. Same definition as Phase 1's migration
  // 020 (CREATE TABLE IF NOT EXISTS keeps both migrations compatible
  // regardless of apply order). Holds the opt-in flag
  // `contribute_anonymized_patterns` ('true'/'false', default false when absent).
  await client.query(`
    CREATE TABLE IF NOT EXISTS clinic_settings (
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      key VARCHAR(100) NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (clinic_id, key)
    )
  `);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS denial_patterns`);
  // NOTE: clinic_settings is shared with other features; do not drop it here.
}
