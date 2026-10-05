import { PoolClient } from 'pg';

/**
 * Migration 015 — Communication preferences / consent (TCPA compliance).
 *
 * 1. Adds SMS + email opt-in flags to `patients` with timestamps and source
 *    (how consent was collected: 'intake', 'front-desk', 'stop-keyword',
 *    'start-keyword', 'staff', 'migration-default').
 * 2. New table `communication_consent_log`: immutable audit trail of every
 *    consent change (patient_id, channel, old/new value, who changed it,
 *    source, timestamp).
 * 3. Extends sms_messages status CHECK to allow 'skipped' (message not sent
 *    because the patient opted out — still recorded for reporting).
 * 4. Backfills existing patients as opted-in (source 'migration-default')
 *    with one consent-log entry per channel, so history starts complete.
 */

export async function up(client: PoolClient): Promise<void> {
  // ── 1. Opt-in columns on patients (duplicate-safe) ──
  const columns = [
    ['sms_opt_in', 'BOOLEAN NOT NULL DEFAULT true'],
    ['email_opt_in', 'BOOLEAN NOT NULL DEFAULT true'],
    ['sms_opt_in_at', 'TIMESTAMPTZ'],
    ['email_opt_in_at', 'TIMESTAMPTZ'],
    ['sms_opt_in_source', 'VARCHAR(50)'],
    ['email_opt_in_source', 'VARCHAR(50)'],
  ];
  for (const [name, type] of columns) {
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE patients ADD COLUMN ${name} ${type};
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);
  }

  // Mark existing rows as opted-in at intake-default where unset
  await client.query(`
    UPDATE patients
    SET sms_opt_in_at = COALESCE(sms_opt_in_at, created_at),
        email_opt_in_at = COALESCE(email_opt_in_at, created_at),
        sms_opt_in_source = COALESCE(sms_opt_in_source, 'migration-default'),
        email_opt_in_source = COALESCE(email_opt_in_source, 'migration-default')
    WHERE sms_opt_in_at IS NULL OR email_opt_in_at IS NULL;
  `);

  // ── 2. Immutable consent-change log ──
  await client.query(`
    CREATE TABLE IF NOT EXISTS communication_consent_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      channel VARCHAR(10) NOT NULL CHECK (channel IN ('sms', 'email')),
      old_value BOOLEAN,
      new_value BOOLEAN NOT NULL,
      changed_by UUID REFERENCES users(id),
      source VARCHAR(50) NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_consent_log_patient ON communication_consent_log(patient_id, changed_at DESC);`
  );

  // ── 3. Allow 'skipped' status on sms_messages ──
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_status_check;
      ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_status_check
        CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'received', 'skipped'));
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;
  `);

  // ── 4. Backfill consent history for existing patients (idempotent) ──
  await client.query(`
    INSERT INTO communication_consent_log (clinic_id, patient_id, channel, old_value, new_value, changed_by, source, changed_at)
    SELECT clinic_id, id, 'sms', NULL, sms_opt_in, NULL, 'migration-default', COALESCE(sms_opt_in_at, NOW())
    FROM patients
    WHERE NOT EXISTS (
      SELECT 1 FROM communication_consent_log l
      WHERE l.patient_id = patients.id AND l.channel = 'sms'
    );
  `);
  await client.query(`
    INSERT INTO communication_consent_log (clinic_id, patient_id, channel, old_value, new_value, changed_by, source, changed_at)
    SELECT clinic_id, id, 'email', NULL, email_opt_in, NULL, 'migration-default', COALESCE(email_opt_in_at, NOW())
    FROM patients
    WHERE NOT EXISTS (
      SELECT 1 FROM communication_consent_log l
      WHERE l.patient_id = patients.id AND l.channel = 'email'
    );
  `);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS communication_consent_log;`);
  for (const col of ['sms_opt_in', 'email_opt_in', 'sms_opt_in_at', 'email_opt_in_at', 'sms_opt_in_source', 'email_opt_in_source']) {
    await client.query(`ALTER TABLE patients DROP COLUMN IF EXISTS ${col};`);
  }
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_status_check;
      ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_status_check
        CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'received'));
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;
  `);
}
