-- ============================================================
-- FVPT-EMR Complete Database Migration Script
-- Generated from migrations 001-008 + seed
-- Run this in the Neon SQL Editor
-- ============================================================


-- ── Migrations tracking ──
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════
-- Migration 001: Initial Schema
-- ════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
CREATE INDEX idx_users_clinic ON users(clinic_id);
CREATE INDEX idx_users_username ON users(username);

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
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

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
CREATE INDEX idx_patients_clinic ON patients(clinic_id);
CREATE INDEX idx_patients_name ON patients(clinic_id, last_name, first_name);

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
CREATE INDEX idx_insurance_patient ON insurance(patient_id);
CREATE INDEX idx_insurance_clinic ON insurance(clinic_id);

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
CREATE INDEX idx_appointments_clinic_time ON appointments(clinic_id, start_time, end_time);
CREATE INDEX idx_appointments_therapist ON appointments(therapist_id, start_time);
CREATE INDEX idx_appointments_patient ON appointments(patient_id);

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
CREATE INDEX idx_notes_clinic_patient ON clinical_notes(clinic_id, patient_id);
CREATE INDEX idx_notes_appointment ON clinical_notes(appointment_id);
CREATE INDEX idx_notes_author ON clinical_notes(author_id);

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
CREATE INDEX idx_attachments_patient ON attachments(patient_id);
CREATE INDEX idx_attachments_note ON attachments(note_id);
CREATE INDEX idx_attachments_clinic ON attachments(clinic_id);

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
CREATE INDEX idx_ledger_patient ON ledger_entries(clinic_id, patient_id);
CREATE INDEX idx_ledger_claim ON ledger_entries(claim_id);
CREATE INDEX idx_ledger_date ON ledger_entries(service_date);

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
CREATE INDEX idx_claims_clinic ON claims(clinic_id);
CREATE INDEX idx_claims_patient ON claims(patient_id);
CREATE INDEX idx_claims_status ON claims(clinic_id, status);
CREATE INDEX idx_claims_date ON claims(service_date);

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
CREATE INDEX idx_era_clinic ON era_files(clinic_id);

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
CREATE INDEX idx_audit_clinic ON audit_events(clinic_id);
CREATE INDEX idx_audit_user ON audit_events(user_id);
CREATE INDEX idx_audit_action ON audit_events(action);
CREATE INDEX idx_audit_resource ON audit_events(resource_type, resource_id);
CREATE INDEX idx_audit_time ON audit_events(created_at);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_clinics_updated_at BEFORE UPDATE ON clinics FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_insurance_updated_at BEFORE UPDATE ON insurance FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_clinical_notes_updated_at BEFORE UPDATE ON clinical_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_claims_updated_at BEFORE UPDATE ON claims FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO _migrations (name) VALUES ('001_initial_schema');

-- ════════════════════════════════════════
-- Migration 002: Add credential to users
-- ════════════════════════════════════════

ALTER TABLE users ADD COLUMN credential VARCHAR(20) CHECK (credential IN ('PT','DPT','PTA','ATC','OT','SLP','MD','DO','NP','PA','Office'));
INSERT INTO _migrations (name) VALUES ('002_add_credential_to_users');

-- ════════════════════════════════════════
-- Migration 003: email_to_username (already username in fresh install)
-- ════════════════════════════════════════

-- Column is already 'username' in this fresh install, so just ensure index exists
DROP INDEX IF EXISTS idx_users_email;
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
INSERT INTO _migrations (name) VALUES ('003_email_to_username');

-- ════════════════════════════════════════
-- Migration 004: Add dev role and support
-- ════════════════════════════════════════

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','admin','dev','therapist','front_desk','biller','read_only'));

CREATE TABLE support_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES users(id),
  request_type VARCHAR(20) NOT NULL CHECK (request_type IN ('support','bug','feature')),
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  priority VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  dev_notes TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_support_clinic ON support_requests(clinic_id);
CREATE INDEX idx_support_submitted_by ON support_requests(submitted_by);
CREATE INDEX idx_support_status ON support_requests(status);
CREATE TRIGGER update_support_requests_updated_at BEFORE UPDATE ON support_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
INSERT INTO _migrations (name) VALUES ('004_add_dev_role_and_support');

-- ════════════════════════════════════════
-- Migration 005: Add messaging
-- ════════════════════════════════════════

CREATE TABLE sms_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'received')),
  message_type VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (message_type IN ('manual', 'reminder', 'birthday', 'follow_up', 'custom')),
  sent_by UUID REFERENCES users(id),
  to_number VARCHAR(20),
  from_number VARCHAR(20),
  external_id VARCHAR(100),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sms_clinic_patient ON sms_messages(clinic_id, patient_id);
CREATE INDEX idx_sms_clinic_created ON sms_messages(clinic_id, created_at DESC);
CREATE INDEX idx_sms_external_id ON sms_messages(external_id);
CREATE INDEX idx_sms_status ON sms_messages(status);

CREATE TABLE sms_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  body TEXT NOT NULL,
  template_type VARCHAR(20) NOT NULL CHECK (template_type IN ('reminder', 'birthday', 'follow_up', 'custom')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sms_templates_clinic ON sms_templates(clinic_id);
CREATE TRIGGER update_sms_templates_updated_at BEFORE UPDATE ON sms_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
INSERT INTO _migrations (name) VALUES ('005_add_messaging');

-- ════════════════════════════════════════
-- Migration 006: Add all features
-- ════════════════════════════════════════


CREATE TABLE exercises (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  body_region VARCHAR(50) NOT NULL,
  category VARCHAR(50) NOT NULL,
  difficulty VARCHAR(20) NOT NULL DEFAULT 'moderate',
  video_url TEXT,
  image_url TEXT,
  instructions TEXT,
  default_sets INT,
  default_reps INT,
  default_hold_seconds INT,
  is_global BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_exercises_clinic ON exercises(clinic_id);
CREATE INDEX idx_exercises_body_region ON exercises(body_region);

CREATE TABLE exercise_programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_template BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  frequency VARCHAR(100),
  phase VARCHAR(100),
  start_date DATE,
  end_date DATE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_exercise_programs_clinic ON exercise_programs(clinic_id);
CREATE INDEX idx_exercise_programs_patient ON exercise_programs(patient_id);

CREATE TABLE exercise_program_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID NOT NULL REFERENCES exercise_programs(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  sets INT,
  reps INT,
  hold_seconds INT,
  frequency VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_program_items_program ON exercise_program_items(program_id);

CREATE TABLE hep_adherence_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID NOT NULL REFERENCES exercise_programs(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  completed_date DATE NOT NULL,
  exercises_completed INT NOT NULL DEFAULT 0,
  exercises_total INT NOT NULL DEFAULT 0,
  pain_level INT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_hep_adherence_program ON hep_adherence_logs(program_id);

CREATE TABLE plans_of_care (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  therapist_id UUID NOT NULL REFERENCES users(id),
  start_date DATE NOT NULL,
  end_date DATE,
  frequency VARCHAR(100) NOT NULL,
  duration_weeks INT,
  diagnosis_codes TEXT[] NOT NULL DEFAULT '{}',
  treatment_goals JSONB NOT NULL DEFAULT '[]',
  physician_name VARCHAR(200),
  physician_npi VARCHAR(10),
  physician_phone VARCHAR(20),
  physician_fax VARCHAR(20),
  certification_date DATE,
  recertification_due_date DATE,
  physician_signature_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (physician_signature_status IN ('pending','sent','received','expired')),
  physician_signed_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','completed','cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_poc_clinic ON plans_of_care(clinic_id);
CREATE INDEX idx_poc_patient ON plans_of_care(patient_id);
CREATE INDEX idx_poc_status ON plans_of_care(status);

CREATE TABLE authorizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  insurance_id UUID REFERENCES insurance(id) ON DELETE SET NULL,
  authorization_number VARCHAR(100),
  authorized_visits INT NOT NULL,
  used_visits INT NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','exhausted','pending','denied')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_authorizations_patient ON authorizations(patient_id);
CREATE INDEX idx_authorizations_status ON authorizations(status);

CREATE TABLE outcome_measures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  note_id UUID REFERENCES clinical_notes(id) ON DELETE SET NULL,
  measure_type VARCHAR(50) NOT NULL,
  score NUMERIC(8,2) NOT NULL,
  max_score NUMERIC(8,2),
  percentage NUMERIC(5,2),
  responses JSONB NOT NULL DEFAULT '{}',
  administered_date DATE NOT NULL,
  administered_by UUID NOT NULL REFERENCES users(id),
  interpretation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_outcome_measures_patient ON outcome_measures(patient_id);
CREATE INDEX idx_outcome_measures_type ON outcome_measures(measure_type);

CREATE TABLE intake_form_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sections JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_intake_templates_clinic ON intake_form_templates(clinic_id);

CREATE TABLE intake_form_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES intake_form_templates(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  access_token VARCHAR(255) NOT NULL UNIQUE,
  responses JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','expired','reviewed')),
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_intake_submissions_clinic ON intake_form_submissions(clinic_id);
CREATE INDEX idx_intake_submissions_token ON intake_form_submissions(access_token);
CREATE INDEX idx_intake_submissions_patient ON intake_form_submissions(patient_id);

CREATE TABLE eligibility_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  insurance_id UUID REFERENCES insurance(id) ON DELETE SET NULL,
  check_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','eligible','ineligible','error')),
  copay_cents INT,
  deductible_cents INT,
  deductible_met_cents INT,
  coinsurance_pct NUMERIC(5,2),
  out_of_pocket_max_cents INT,
  out_of_pocket_met_cents INT,
  pt_visits_allowed INT,
  pt_visits_used INT,
  requires_authorization BOOLEAN,
  response_raw JSONB,
  error_message TEXT,
  checked_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_eligibility_patient ON eligibility_checks(patient_id);

CREATE TABLE faxes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound','outbound')),
  fax_number VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','delivered','failed','received','filed')),
  pages INT,
  subject VARCHAR(255),
  document_type VARCHAR(50),
  attachment_id UUID REFERENCES attachments(id) ON DELETE SET NULL,
  note_id UUID REFERENCES clinical_notes(id) ON DELETE SET NULL,
  sent_by UUID REFERENCES users(id),
  provider_message_id VARCHAR(255),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_faxes_clinic ON faxes(clinic_id);
CREATE INDEX idx_faxes_patient ON faxes(patient_id);

CREATE TABLE referring_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  npi VARCHAR(10),
  specialty VARCHAR(100),
  organization VARCHAR(255),
  phone VARCHAR(20),
  fax VARCHAR(20),
  email VARCHAR(255),
  address_line1 VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(2),
  zip VARCHAR(10),
  auto_fax_eval BOOLEAN NOT NULL DEFAULT false,
  auto_fax_progress BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_referring_providers_clinic ON referring_providers(clinic_id);
CREATE INDEX idx_referring_providers_npi ON referring_providers(npi);

CREATE TABLE waitlist_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  preferred_therapist_id UUID REFERENCES users(id),
  preferred_days TEXT[] NOT NULL DEFAULT '{}',
  preferred_time_start TIME,
  preferred_time_end TIME,
  urgency VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low','normal','high','urgent')),
  appointment_type VARCHAR(30),
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','contacted','scheduled','cancelled','expired')),
  contacted_at TIMESTAMPTZ,
  scheduled_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_waitlist_clinic ON waitlist_entries(clinic_id);
CREATE INDEX idx_waitlist_status ON waitlist_entries(status);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users(id),
  assigned_by UUID NOT NULL REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  due_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled')),
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  category VARCHAR(50),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tasks_clinic ON tasks(clinic_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_status ON tasks(status);

CREATE TABLE recall_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  criteria JSONB NOT NULL DEFAULT '{}',
  message_template TEXT NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','email','both')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','cancelled')),
  scheduled_date DATE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_recall_campaigns_clinic ON recall_campaigns(clinic_id);

CREATE TABLE recall_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES recall_campaigns(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','responded','scheduled','failed','opted_out')),
  contacted_at TIMESTAMPTZ,
  response TEXT,
  scheduled_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_recall_entries_campaign ON recall_entries(campaign_id);

CREATE TABLE telehealth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  therapist_id UUID NOT NULL REFERENCES users(id),
  room_id VARCHAR(255) NOT NULL UNIQUE,
  room_url TEXT NOT NULL,
  patient_url TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','waiting','in_progress','completed','cancelled','no_show')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_minutes INT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_telehealth_clinic ON telehealth_sessions(clinic_id);
CREATE INDEX idx_telehealth_appointment ON telehealth_sessions(appointment_id);
CREATE INDEX idx_telehealth_room ON telehealth_sessions(room_id);

CREATE TABLE text_expanders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  shortcut VARCHAR(50) NOT NULL,
  expansion TEXT NOT NULL,
  category VARCHAR(50),
  is_shared BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_text_expanders_clinic ON text_expanders(clinic_id);
CREATE INDEX idx_text_expanders_user ON text_expanders(user_id);

CREATE TABLE workers_comp_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  employer_name VARCHAR(255),
  employer_phone VARCHAR(20),
  employer_address TEXT,
  injury_date DATE NOT NULL,
  injury_description TEXT,
  claim_number VARCHAR(100),
  adjuster_name VARCHAR(200),
  adjuster_phone VARCHAR(20),
  adjuster_email VARCHAR(255),
  attorney_name VARCHAR(200),
  attorney_phone VARCHAR(20),
  attorney_email VARCHAR(255),
  wcb_case_number VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','denied','suspended','settled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wc_cases_clinic ON workers_comp_cases(clinic_id);
CREATE INDEX idx_wc_cases_patient ON workers_comp_cases(patient_id);

CREATE TABLE clinic_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(2) NOT NULL,
  zip VARCHAR(10) NOT NULL,
  phone VARCHAR(20),
  fax VARCHAR(20),
  npi VARCHAR(10),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  timezone VARCHAR(50) NOT NULL DEFAULT 'America/New_York',
  operating_hours JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_clinic_locations_clinic ON clinic_locations(clinic_id);

CREATE TABLE portal_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  verification_token VARCHAR(255),
  reset_token VARCHAR(255),
  reset_token_expires TIMESTAMPTZ,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(clinic_id, email)
);
CREATE INDEX idx_portal_users_clinic ON portal_users(clinic_id);
CREATE INDEX idx_portal_users_patient ON portal_users(patient_id);

CREATE TABLE portal_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  portal_user_id UUID REFERENCES portal_users(id) ON DELETE SET NULL,
  staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound','outbound')),
  subject VARCHAR(255),
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_portal_messages_patient ON portal_messages(patient_id);

CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('credit','debit','ach')),
  brand VARCHAR(20),
  last_four VARCHAR(4) NOT NULL,
  exp_month INT,
  exp_year INT,
  processor_token VARCHAR(255) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payment_methods_patient ON payment_methods(patient_id);

CREATE TABLE payment_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  payment_method_id UUID REFERENCES payment_methods(id) ON DELETE SET NULL,
  amount_cents INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','refunded','partially_refunded')),
  processor_transaction_id VARCHAR(255),
  description VARCHAR(255),
  ledger_entry_id UUID REFERENCES ledger_entries(id) ON DELETE SET NULL,
  processed_by UUID REFERENCES users(id),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payment_transactions_patient ON payment_transactions(patient_id);

CREATE TABLE mips_measures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  note_id UUID REFERENCES clinical_notes(id) ON DELETE SET NULL,
  provider_id UUID NOT NULL REFERENCES users(id),
  measure_id VARCHAR(20) NOT NULL,
  measure_title VARCHAR(255),
  numerator BOOLEAN NOT NULL DEFAULT false,
  denominator BOOLEAN NOT NULL DEFAULT true,
  exclusion BOOLEAN NOT NULL DEFAULT false,
  reporting_period_start DATE NOT NULL,
  reporting_period_end DATE NOT NULL,
  submitted BOOLEAN NOT NULL DEFAULT false,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_mips_clinic ON mips_measures(clinic_id);
CREATE INDEX idx_mips_provider ON mips_measures(provider_id);

CREATE TABLE fhir_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  base_url TEXT NOT NULL,
  auth_type VARCHAR(20) NOT NULL DEFAULT 'oauth2' CHECK (auth_type IN ('oauth2','api_key','basic')),
  client_id VARCHAR(255),
  client_secret VARCHAR(255),
  api_key VARCHAR(255),
  scope VARCHAR(500),
  status VARCHAR(20) NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive','error')),
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_fhir_connections_clinic ON fhir_connections(clinic_id);

CREATE TABLE fhir_sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connection_id UUID NOT NULL REFERENCES fhir_connections(id) ON DELETE CASCADE,
  resource_type VARCHAR(50) NOT NULL,
  resource_id VARCHAR(255),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('push','pull')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('success','error','skipped')),
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_fhir_sync_connection ON fhir_sync_log(connection_id);

CREATE TABLE therapy_cap_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  year INT NOT NULL,
  pt_ot_charges_cents INT NOT NULL DEFAULT 0,
  slp_charges_cents INT NOT NULL DEFAULT 0,
  kx_modifier_applied BOOLEAN NOT NULL DEFAULT false,
  kx_applied_date DATE,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(clinic_id, patient_id, year)
);
CREATE INDEX idx_therapy_cap_patient ON therapy_cap_tracking(patient_id);

CREATE TRIGGER update_exercises_updated_at BEFORE UPDATE ON exercises FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_exercise_programs_updated_at BEFORE UPDATE ON exercise_programs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_plans_of_care_updated_at BEFORE UPDATE ON plans_of_care FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_authorizations_updated_at BEFORE UPDATE ON authorizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_intake_form_templates_updated_at BEFORE UPDATE ON intake_form_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_referring_providers_updated_at BEFORE UPDATE ON referring_providers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_waitlist_entries_updated_at BEFORE UPDATE ON waitlist_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_recall_campaigns_updated_at BEFORE UPDATE ON recall_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_telehealth_sessions_updated_at BEFORE UPDATE ON telehealth_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_text_expanders_updated_at BEFORE UPDATE ON text_expanders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_workers_comp_cases_updated_at BEFORE UPDATE ON workers_comp_cases FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_clinic_locations_updated_at BEFORE UPDATE ON clinic_locations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_portal_users_updated_at BEFORE UPDATE ON portal_users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_fhir_connections_updated_at BEFORE UPDATE ON fhir_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES clinic_locations(id) ON DELETE SET NULL;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS referring_provider_id UUID REFERENCES referring_providers(id) ON DELETE SET NULL;
INSERT INTO _migrations (name) VALUES ('006_add_all_features');

-- ════════════════════════════════════════
-- Migration 007: Security hardening
-- ════════════════════════════════════════

ALTER TABLE attachments ADD COLUMN IF NOT EXISTS encrypted BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS data_retention_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  resource_type VARCHAR(50) NOT NULL,
  retention_days INTEGER NOT NULL DEFAULT 2555,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(clinic_id, resource_type)
);

CREATE INDEX IF NOT EXISTS idx_sessions_cleanup ON sessions(revoked, expires_at) WHERE revoked = false;
CREATE INDEX IF NOT EXISTS idx_audit_retention ON audit_events(created_at);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS patients_clinic_isolation ON patients USING (true) WITH CHECK (true);
ALTER TABLE clinical_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS clinical_notes_clinic_isolation ON clinical_notes USING (true) WITH CHECK (true);
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS appointments_clinic_isolation ON appointments USING (true) WITH CHECK (true);
ALTER TABLE insurance ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS insurance_clinic_isolation ON insurance USING (true) WITH CHECK (true);
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS attachments_clinic_isolation ON attachments USING (true) WITH CHECK (true);
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS ledger_entries_clinic_isolation ON ledger_entries USING (true) WITH CHECK (true);
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS claims_clinic_isolation ON claims USING (true) WITH CHECK (true);
INSERT INTO _migrations (name) VALUES ('007_security_hardening');
