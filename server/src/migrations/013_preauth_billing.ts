import { PoolClient } from 'pg';

/**
 * Migration 013 — Pre-authorization + billing foundations.
 *
 * 1. New table `payer_auth_requirements`: per-clinic payer cheat-sheet —
 *    which payers require prior auth for outpatient PT, typical visit
 *    limits, required packet fields, and submission contact info.
 * 2. `authorizations` workflow columns: submitted_at, follow_up_date,
 *    denial_reason, packet_data / packet_generated_at, workflow_status.
 * 3. `insurance` eligibility snapshot columns: eligibility_verified_at,
 *    eligibility_status, eligibility_summary.
 * 4. Seeds the 5 common payer profiles for every existing clinic
 *    (idempotent — ON CONFLICT DO NOTHING).
 */

export async function up(client: PoolClient): Promise<void> {
  // ── 1. payer_auth_requirements table ──
  await client.query(`
    CREATE TABLE IF NOT EXISTS payer_auth_requirements (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      payer_name VARCHAR(255) NOT NULL,
      requires_auth_for_pt BOOLEAN NOT NULL DEFAULT true,
      typical_visit_limit INTEGER,
      required_fields JSONB NOT NULL DEFAULT '[]',
      submission_notes TEXT,
      phone VARCHAR(50),
      portal_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(clinic_id, payer_name)
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_payer_auth_requirements_clinic ON payer_auth_requirements(clinic_id);`
  );

  // ── 2. authorizations workflow columns (duplicate-safe) ──
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE authorizations ADD COLUMN submitted_at TIMESTAMPTZ;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE authorizations ADD COLUMN follow_up_date DATE;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE authorizations ADD COLUMN denial_reason TEXT;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE authorizations ADD COLUMN packet_data JSONB;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE authorizations ADD COLUMN packet_generated_at TIMESTAMPTZ;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE authorizations ADD COLUMN workflow_status VARCHAR(20) NOT NULL DEFAULT 'draft';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);

  // ── 3. insurance eligibility snapshot columns (duplicate-safe) ──
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE insurance ADD COLUMN eligibility_verified_at TIMESTAMPTZ;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE insurance ADD COLUMN eligibility_status VARCHAR(20);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE insurance ADD COLUMN eligibility_summary JSONB;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);

  // ── 4. Seed payer profiles for every existing clinic ──
  await client.query(`
    INSERT INTO payer_auth_requirements
      (clinic_id, payer_name, requires_auth_for_pt, typical_visit_limit, required_fields, submission_notes, phone, portal_url)
    SELECT
      id,
      payer.payer_name,
      payer.requires_auth_for_pt,
      payer.typical_visit_limit,
      payer.required_fields::jsonb,
      payer.submission_notes,
      payer.phone,
      payer.portal_url
    FROM clinics,
    (VALUES
      ('Medicare', false, NULL, '["eval_note","plan_of_care","diagnosis_codes"]',
       'Medicare does not require prior auth for outpatient PT; KX modifier required over therapy cap threshold.',
       '1-800-MEDICARE', 'https://www.cms.gov'),
      ('UnitedHealthcare', true, 30, '["eval_note","plan_of_care","diagnosis_codes","clinical_justification"]',
       'UHC requires auth via Optum portal before 3rd visit for most plans.',
       '1-877-842-3210', 'https://www.uhcprovider.com'),
      ('BCBS', true, 24, '["eval_note","plan_of_care","diagnosis_codes"]',
       'Varies by state plan; most require auth after initial eval.',
       '1-800-810-2583', 'https://www.bcbs.com'),
      ('Aetna', true, 30, '["eval_note","plan_of_care","diagnosis_codes","clinical_justification"]',
       'Auth via Eviti portal for most commercial plans.',
       '1-800-624-0756', 'https://www.aetna.com'),
      ('Cigna', true, 20, '["eval_note","plan_of_care","diagnosis_codes"]',
       'Auth via Cigna for Health Care Professionals portal.',
       '1-800-88CIGNA', 'https://www.cigna.com')
    ) AS payer(payer_name, requires_auth_for_pt, typical_visit_limit, required_fields, submission_notes, phone, portal_url)
    ON CONFLICT (clinic_id, payer_name) DO NOTHING;
  `);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS payer_auth_requirements CASCADE;`);
  await client.query(`
    ALTER TABLE authorizations
      DROP COLUMN IF EXISTS submitted_at,
      DROP COLUMN IF EXISTS follow_up_date,
      DROP COLUMN IF EXISTS denial_reason,
      DROP COLUMN IF EXISTS packet_data,
      DROP COLUMN IF EXISTS packet_generated_at,
      DROP COLUMN IF EXISTS workflow_status;
  `);
  await client.query(`
    ALTER TABLE insurance
      DROP COLUMN IF EXISTS eligibility_verified_at,
      DROP COLUMN IF EXISTS eligibility_status,
      DROP COLUMN IF EXISTS eligibility_summary;
  `);
}
