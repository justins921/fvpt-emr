/**
 * Migration 020 — AI billing Phase 1: underpayment detection.
 *
 * - fee_schedules: contracted rate sets per clinic. payer_name NULL = default
 *   (standard) schedule; otherwise payer-specific. One default per clinic.
 * - fee_schedule_items: CPT → allowed amount (cents) per schedule.
 * - underpayment_flags: detected paid < allowed line items with review workflow.
 * - clinic_settings: key/value clinic settings (underpayment threshold etc).
 */
export async function up(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS fee_schedules (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      payer_name VARCHAR(255),
      name VARCHAR(255) NOT NULL,
      effective_date DATE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_schedules_default
      ON fee_schedules (clinic_id) WHERE payer_name IS NULL;
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_schedules_payer
      ON fee_schedules (clinic_id, payer_name) WHERE payer_name IS NOT NULL;
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_fee_schedules_clinic
      ON fee_schedules (clinic_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS fee_schedule_items (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      schedule_id UUID NOT NULL REFERENCES fee_schedules(id) ON DELETE CASCADE,
      cpt_code VARCHAR(20) NOT NULL,
      allowed_amount_cents INTEGER NOT NULL CHECK (allowed_amount_cents >= 0),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (schedule_id, cpt_code)
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_fee_schedule_items_schedule
      ON fee_schedule_items (schedule_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS underpayment_flags (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      cpt_code VARCHAR(20) NOT NULL,
      billed_cents INTEGER NOT NULL DEFAULT 0,
      allowed_cents INTEGER NOT NULL,
      paid_cents INTEGER NOT NULL DEFAULT 0,
      shortfall_cents INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','in_review','appealed','resolved','wont_pursue')),
      notes TEXT,
      era_id UUID REFERENCES era_files(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (clinic_id, claim_id, cpt_code)
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_underpayment_flags_clinic
      ON underpayment_flags (clinic_id);
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_underpayment_flags_status
      ON underpayment_flags (clinic_id, status);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS clinic_settings (
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      key VARCHAR(100) NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (clinic_id, key)
    );
  `);
}

export async function down(client: any): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS underpayment_flags;`);
  await client.query(`DROP TABLE IF EXISTS fee_schedule_items;`);
  await client.query(`DROP TABLE IF EXISTS fee_schedules;`);
  await client.query(`DROP TABLE IF EXISTS clinic_settings;`);
}
