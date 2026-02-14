import { PoolClient } from 'pg';

export async function up(client: PoolClient): Promise<void> {
  // Extensions
  await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // ── Clinics ──
  await client.query(`
    CREATE TABLE clinics (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(255) NOT NULL,
      npi VARCHAR(10) NOT NULL,
      tax_id VARCHAR(20) NOT NULL,
      address_line1 VARCHAR(255) NOT NULL,
      address_line2 VARCHAR(255),
      city VARCHAR(100) NOT NULL,
      state VARCHAR(2) NOT NULL,
      zip VARCHAR(10) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      fax VARCHAR(20),
      settings JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Users ──
  await client.query(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      username VARCHAR(100) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('owner','admin','therapist','front_desk','biller','read_only')),
      npi VARCHAR(10),
      license_number VARCHAR(50),
      is_active BOOLEAN NOT NULL DEFAULT true,
      mfa_secret VARCHAR(255),
      mfa_enabled BOOLEAN NOT NULL DEFAULT false,
      last_login TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(clinic_id, username)
    );
  `);

  await client.query(`CREATE INDEX idx_users_clinic ON users(clinic_id);`);
  await client.query(`CREATE INDEX idx_users_username ON users(username);`);

  // ── Sessions ──
  await client.query(`
    CREATE TABLE sessions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      refresh_token_hash VARCHAR(255) NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_sessions_user ON sessions(user_id);`);
  await client.query(`CREATE INDEX idx_sessions_expires ON sessions(expires_at);`);

  // ── Patients ──
  await client.query(`
    CREATE TABLE patients (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      mrn VARCHAR(50) NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      date_of_birth DATE NOT NULL,
      gender VARCHAR(20) NOT NULL,
      ssn_last4 VARCHAR(4),
      email VARCHAR(255),
      phone VARCHAR(20),
      address_line1 VARCHAR(255),
      address_line2 VARCHAR(255),
      city VARCHAR(100),
      state VARCHAR(2),
      zip VARCHAR(10),
      emergency_contact_name VARCHAR(200),
      emergency_contact_phone VARCHAR(20),
      guarantor_name VARCHAR(200),
      guarantor_phone VARCHAR(20),
      guarantor_relationship VARCHAR(50),
      referral_source VARCHAR(200),
      referring_provider VARCHAR(200),
      referring_provider_npi VARCHAR(10),
      primary_diagnosis_icd10 VARCHAR(10),
      secondary_diagnoses_icd10 TEXT[] DEFAULT '{}',
      precautions TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(clinic_id, mrn)
    );
  `);

  await client.query(`CREATE INDEX idx_patients_clinic ON patients(clinic_id);`);
  await client.query(`CREATE INDEX idx_patients_name ON patients(clinic_id, last_name, first_name);`);

  // ── Insurance ──
  await client.query(`
    CREATE TABLE insurance (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      payer_name VARCHAR(255) NOT NULL,
      payer_id VARCHAR(50) NOT NULL,
      plan_name VARCHAR(255),
      member_id VARCHAR(100) NOT NULL,
      group_number VARCHAR(100),
      subscriber_name VARCHAR(200) NOT NULL,
      subscriber_dob DATE NOT NULL,
      subscriber_relationship VARCHAR(50) NOT NULL,
      coverage_start DATE NOT NULL,
      coverage_end DATE,
      authorization_number VARCHAR(100),
      authorized_visits INTEGER,
      used_visits INTEGER NOT NULL DEFAULT 0,
      is_primary BOOLEAN NOT NULL DEFAULT true,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_insurance_patient ON insurance(patient_id);`);
  await client.query(`CREATE INDEX idx_insurance_clinic ON insurance(clinic_id);`);

  // ── Appointments ──
  await client.query(`
    CREATE TABLE appointments (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      therapist_id UUID NOT NULL REFERENCES users(id),
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ NOT NULL,
      appointment_type VARCHAR(30) NOT NULL CHECK (appointment_type IN ('evaluation','follow_up','re_evaluation','discharge')),
      status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','checked_in','in_progress','completed','cancelled','no_show')),
      notes TEXT,
      recurring_rule TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_appointments_clinic_time ON appointments(clinic_id, start_time, end_time);`);
  await client.query(`CREATE INDEX idx_appointments_therapist ON appointments(therapist_id, start_time);`);
  await client.query(`CREATE INDEX idx_appointments_patient ON appointments(patient_id);`);

  // ── Clinical Notes ──
  await client.query(`
    CREATE TABLE clinical_notes (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      appointment_id UUID REFERENCES appointments(id),
      author_id UUID NOT NULL REFERENCES users(id),
      note_type VARCHAR(20) NOT NULL CHECK (note_type IN ('evaluation','daily_soap','progress','discharge')),
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final','amended')),
      version INTEGER NOT NULL DEFAULT 1,
      parent_note_id UUID REFERENCES clinical_notes(id),
      amendment_reason TEXT,
      subjective TEXT,
      objective TEXT,
      assessment TEXT,
      plan TEXT,
      eval_data JSONB,
      cpt_codes TEXT[] DEFAULT '{}',
      icd10_codes TEXT[] DEFAULT '{}',
      treatment_time_minutes INTEGER,
      signed_by UUID REFERENCES users(id),
      signed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_notes_clinic_patient ON clinical_notes(clinic_id, patient_id);`);
  await client.query(`CREATE INDEX idx_notes_appointment ON clinical_notes(appointment_id);`);
  await client.query(`CREATE INDEX idx_notes_author ON clinical_notes(author_id);`);

  // ── Attachments ──
  await client.query(`
    CREATE TABLE attachments (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
      note_id UUID REFERENCES clinical_notes(id) ON DELETE SET NULL,
      claim_id UUID,
      filename VARCHAR(255) NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      size_bytes BIGINT NOT NULL,
      storage_path VARCHAR(500) NOT NULL,
      uploaded_by UUID NOT NULL REFERENCES users(id),
      scan_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected','skipped')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_attachments_patient ON attachments(patient_id);`);
  await client.query(`CREATE INDEX idx_attachments_note ON attachments(note_id);`);
  await client.query(`CREATE INDEX idx_attachments_clinic ON attachments(clinic_id);`);

  // ── Ledger ──
  await client.query(`
    CREATE TABLE ledger_entries (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      claim_id UUID,
      entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('charge','payment','adjustment','refund','write_off')),
      amount_cents INTEGER NOT NULL,
      description TEXT NOT NULL,
      cpt_code VARCHAR(10),
      service_date DATE,
      payer_name VARCHAR(255),
      check_number VARCHAR(100),
      posted_by UUID NOT NULL REFERENCES users(id),
      posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_ledger_patient ON ledger_entries(clinic_id, patient_id);`);
  await client.query(`CREATE INDEX idx_ledger_claim ON ledger_entries(claim_id);`);
  await client.query(`CREATE INDEX idx_ledger_date ON ledger_entries(service_date);`);

  // ── Claims ──
  await client.query(`
    CREATE TABLE claims (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      appointment_id UUID REFERENCES appointments(id),
      note_id UUID REFERENCES clinical_notes(id),
      insurance_id UUID REFERENCES insurance(id),
      status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scrubbed','scrub_failed','submitted','acknowledged','accepted','rejected','denied','paid','partially_paid','appealed')),
      claim_number VARCHAR(50),
      payer_claim_number VARCHAR(50),
      service_date DATE NOT NULL,
      billing_provider_npi VARCHAR(10) NOT NULL,
      rendering_provider_npi VARCHAR(10) NOT NULL,
      diagnosis_codes TEXT[] DEFAULT '{}',
      line_items JSONB NOT NULL DEFAULT '[]',
      total_charge_cents INTEGER NOT NULL DEFAULT 0,
      total_paid_cents INTEGER NOT NULL DEFAULT 0,
      total_adjustment_cents INTEGER NOT NULL DEFAULT 0,
      patient_responsibility_cents INTEGER NOT NULL DEFAULT 0,
      scrub_errors TEXT[] DEFAULT '{}',
      submitted_at TIMESTAMPTZ,
      era_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_claims_clinic ON claims(clinic_id);`);
  await client.query(`CREATE INDEX idx_claims_patient ON claims(patient_id);`);
  await client.query(`CREATE INDEX idx_claims_status ON claims(clinic_id, status);`);
  await client.query(`CREATE INDEX idx_claims_date ON claims(service_date);`);

  // ── ERA Files ──
  await client.query(`
    CREATE TABLE era_files (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      raw_content TEXT NOT NULL,
      check_number VARCHAR(100),
      check_date DATE,
      payer_name VARCHAR(255),
      total_paid_cents INTEGER NOT NULL DEFAULT 0,
      claims_count INTEGER NOT NULL DEFAULT 0,
      posted BOOLEAN NOT NULL DEFAULT false,
      posted_by UUID REFERENCES users(id),
      posted_at TIMESTAMPTZ,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_era_clinic ON era_files(clinic_id);`);

  // ── Audit Events (append-only) ──
  await client.query(`
    CREATE TABLE audit_events (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL,
      user_id UUID,
      action VARCHAR(50) NOT NULL,
      resource_type VARCHAR(50),
      resource_id UUID,
      details JSONB NOT NULL DEFAULT '{}',
      ip_address VARCHAR(45) NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Make audit_events append-only: revoke UPDATE and DELETE
  await client.query(`CREATE INDEX idx_audit_clinic ON audit_events(clinic_id);`);
  await client.query(`CREATE INDEX idx_audit_user ON audit_events(user_id);`);
  await client.query(`CREATE INDEX idx_audit_action ON audit_events(action);`);
  await client.query(`CREATE INDEX idx_audit_resource ON audit_events(resource_type, resource_id);`);
  await client.query(`CREATE INDEX idx_audit_time ON audit_events(created_at);`);

  // ── Migrations tracking ──
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Updated_at trigger function
  await client.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  // Apply updated_at triggers
  const tablesWithUpdatedAt = [
    'clinics', 'users', 'patients', 'insurance', 'appointments',
    'clinical_notes', 'claims'
  ];
  for (const table of tablesWithUpdatedAt) {
    await client.query(`
      CREATE TRIGGER update_${table}_updated_at
      BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
  }
}

export async function down(client: PoolClient): Promise<void> {
  const tables = [
    'audit_events', 'era_files', 'claims', 'ledger_entries',
    'attachments', 'clinical_notes', 'appointments', 'insurance',
    'patients', 'sessions', 'users', 'clinics', '_migrations'
  ];
  for (const table of tables) {
    await client.query(`DROP TABLE IF EXISTS ${table} CASCADE;`);
  }
  await client.query(`DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;`);
}
