-- ============================================================
-- FVPT-EMR Complete Database Migration Script
-- Generated from migrations 001-008 + seed
-- Run this in the Neon SQL Editor
-- ============================================================

BEGIN;

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

-- ════════════════════════════════════════
-- Migration 008: Seed exercises and features
-- ════════════════════════════════════════

ALTER TABLE exercises ALTER COLUMN clinic_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS demo_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL,
  clinic_name VARCHAR(255) NOT NULL,
  provider_count VARCHAR(20),
  phone VARCHAR(30),
  current_emr VARCHAR(100),
  message TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','demo_scheduled','converted','closed')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demo_requests_status ON demo_requests(status);
CREATE INDEX IF NOT EXISTS idx_demo_requests_email ON demo_requests(email);

CREATE TABLE IF NOT EXISTS sso_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('saml','oidc','google','azure_ad','okta')),
  display_name VARCHAR(100) NOT NULL,
  client_id VARCHAR(255),
  client_secret_encrypted TEXT,
  issuer_url TEXT,
  metadata_url TEXT,
  certificate TEXT,
  domain_hint VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT false,
  auto_provision_users BOOLEAN NOT NULL DEFAULT false,
  default_role VARCHAR(20) NOT NULL DEFAULT 'therapist',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(clinic_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_sso_connections_clinic ON sso_connections(clinic_id);

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(20) NOT NULL DEFAULT 'starter' CHECK (plan_tier IN ('starter','professional','enterprise')),
  ADD COLUMN IF NOT EXISTS account_manager_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS account_manager_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS account_manager_phone VARCHAR(30);

-- ── Seed 500+ global PT exercises ──
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cervical Isometric Flexion', 'Strengthen deep cervical flexors by pressing forehead into palm', 'cervical', 'strengthening', 'beginner', 'Place palm against forehead. Push head forward into hand without moving head. Hold, then relax.', 3, 10, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cervical Isometric Extension', 'Strengthen cervical extensors by pressing back of head into palm', 'cervical', 'strengthening', 'beginner', 'Place palm against back of head. Push head backward into hand without moving head. Hold, then relax.', 3, 10, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cervical Isometric Side Flexion', 'Strengthen lateral cervical muscles with isometric resistance', 'cervical', 'strengthening', 'beginner', 'Place palm against side of head above ear. Push head sideways into hand without moving. Hold, then relax. Repeat on other side.', 3, 10, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cervical Isometric Rotation', 'Resist rotation with isometric hold', 'cervical', 'strengthening', 'beginner', 'Place palm on side of forehead. Try to turn head into hand without moving. Hold, then relax. Repeat on other side.', 3, 10, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Chin Tuck with Resistance Band', 'Strengthen deep cervical flexors with band resistance', 'cervical', 'strengthening', 'moderate', 'Loop resistance band around back of head. Tuck chin toward chest against band resistance. Hold, then return slowly.', 3, 12, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Prone Cervical Extension', 'Strengthen cervical extensors in prone position', 'cervical', 'strengthening', 'moderate', 'Lie face down with forehead on hands. Lift head slightly off hands. Hold, then lower slowly.', 3, 10, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Supine Cervical Curl', 'Strengthen deep neck flexors against gravity', 'cervical', 'strengthening', 'moderate', 'Lie on back with knees bent. Tuck chin and lift head 1 inch off surface. Hold, then lower slowly.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Scapular Retraction with Chin Tuck', 'Combined neck and upper back strengthening', 'cervical', 'strengthening', 'moderate', 'Sit tall. Tuck chin while squeezing shoulder blades together. Hold, then relax.', 3, 12, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Upper Trapezius Stretch', 'Stretch the upper trapezius and levator scapulae', 'cervical', 'stretching', 'beginner', 'Sit tall. Tilt ear toward shoulder. Gently apply overpressure with hand. Hold, then repeat on other side.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Levator Scapulae Stretch', 'Stretch the levator scapulae muscle', 'cervical', 'stretching', 'beginner', 'Look down toward opposite armpit. Gently apply overpressure with hand on back of head. Hold, then switch sides.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'SCM Stretch', 'Stretch the sternocleidomastoid muscle', 'cervical', 'stretching', 'beginner', 'Rotate head to one side, then tilt chin upward. You should feel a stretch along the front of the neck. Hold, then switch.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Chin Tuck Stretch', 'Stretch suboccipital muscles with chin tuck', 'cervical', 'stretching', 'beginner', 'Sit tall. Draw chin straight back making a "double chin". Hold at end range. Relax and repeat.', 3, 10, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Scalene Stretch', 'Stretch the anterior and middle scalene muscles', 'cervical', 'stretching', 'beginner', 'Anchor hand behind back. Tilt head away from anchored arm. Gently assist with other hand. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Doorway Pec Stretch with Neck Extension', 'Combined pec and anterior neck stretch', 'cervical', 'stretching', 'moderate', 'Stand in doorway with arms at 90 degrees. Step forward through doorway. Gently tilt head back for added neck stretch.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cervical Flexion ROM', 'Active range of motion for cervical flexion', 'cervical', 'rom', 'beginner', 'Sit tall. Slowly lower chin toward chest. Hold briefly, then return to neutral. Move through pain-free range only.', 2, 10, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cervical Extension ROM', 'Active range of motion for cervical extension', 'cervical', 'rom', 'beginner', 'Sit tall. Slowly look up toward ceiling. Hold briefly, then return to neutral.', 2, 10, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cervical Rotation ROM', 'Active range of motion for cervical rotation', 'cervical', 'rom', 'beginner', 'Sit tall. Slowly turn head to look over shoulder. Hold briefly, return to center, then repeat to other side.', 2, 10, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cervical Side Flexion ROM', 'Active range of motion for cervical lateral flexion', 'cervical', 'rom', 'beginner', 'Sit tall. Slowly tilt ear toward shoulder without shrugging. Hold briefly, return to center, repeat on other side.', 2, 10, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cervical Circles', 'Gentle full range of motion in circular pattern', 'cervical', 'rom', 'beginner', 'Slowly move head in a gentle circle, combining flexion, rotation, extension, and side flexion. Reverse direction.', 2, 5, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cervical Retraction-Extension', 'Combined chin tuck and extension movement', 'cervical', 'rom', 'moderate', 'Start with chin tuck. From tucked position, slowly extend neck looking upward. Return to tuck. Repeat.', 2, 10, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Shoulder External Rotation with Band', 'Strengthen rotator cuff external rotators', 'shoulder', 'strengthening', 'beginner', 'Stand with elbow at side bent 90 degrees. Hold band attached to door. Rotate forearm outward. Slowly return.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Shoulder Internal Rotation with Band', 'Strengthen rotator cuff internal rotators', 'shoulder', 'strengthening', 'beginner', 'Stand with elbow at side bent 90 degrees. Hold band attached to door. Rotate forearm inward across body. Slowly return.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Shoulder Flexion with Band', 'Strengthen anterior deltoid and shoulder flexors', 'shoulder', 'strengthening', 'beginner', 'Stand on band. Hold end with thumb up. Raise arm forward to shoulder height. Slowly lower.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Shoulder Abduction with Band', 'Strengthen middle deltoid with band resistance', 'shoulder', 'strengthening', 'beginner', 'Stand on band. Raise arm out to side to shoulder height with thumb up. Slowly lower.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Prone Y Raise', 'Strengthen lower trapezius and serratus anterior', 'shoulder', 'strengthening', 'moderate', 'Lie face down on bench or bed. Raise arms in Y shape with thumbs up. Hold briefly at top. Slowly lower.', 3, 12, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Prone T Raise', 'Strengthen middle trapezius and rhomboids', 'shoulder', 'strengthening', 'moderate', 'Lie face down on bench or bed. Raise arms out to sides in T shape with thumbs up. Squeeze shoulder blades. Lower slowly.', 3, 12, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Prone W Raise', 'Strengthen external rotators and scapular stabilizers', 'shoulder', 'strengthening', 'moderate', 'Lie face down. Start with arms in W position (elbows bent, hands up). Lift hands toward ceiling squeezing shoulder blades. Lower slowly.', 3, 12, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Side-Lying External Rotation', 'Isolate infraspinatus and teres minor', 'shoulder', 'strengthening', 'beginner', 'Lie on uninvolved side. Hold light weight with top arm, elbow at side bent 90 degrees. Rotate forearm toward ceiling. Slowly lower.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Scapular Push-Up Plus', 'Strengthen serratus anterior with protraction', 'shoulder', 'strengthening', 'moderate', 'In push-up position (or on knees). Arms straight. Push shoulder blades apart by pressing into floor. Allow shoulder blades to come together. Repeat.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Wall Push-Up', 'Gentle shoulder strengthening in weight-bearing', 'shoulder', 'strengthening', 'beginner', 'Stand arm-length from wall. Place hands on wall at shoulder height. Bend elbows to lean toward wall. Push back to start.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Shoulder Shrug', 'Strengthen upper trapezius', 'shoulder', 'strengthening', 'beginner', 'Stand with arms at sides. Shrug shoulders toward ears. Hold at top briefly. Slowly lower.', 3, 15, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Scapular Retraction', 'Strengthen rhomboids and middle trapezius', 'shoulder', 'strengthening', 'beginner', 'Sit or stand tall. Squeeze shoulder blades together as if holding a pencil between them. Hold, then relax.', 3, 15, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Empty Can Exercise', 'Strengthen supraspinatus', 'shoulder', 'strengthening', 'moderate', 'Stand with arms at sides, thumbs pointed down (like pouring out a can). Raise arms to 45 degrees out to the side. Slowly lower.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Shoulder Press with Band', 'Overhead pressing with band resistance', 'shoulder', 'strengthening', 'moderate', 'Stand on band. Hold ends at shoulder height. Press overhead until arms are straight. Slowly lower.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Lat Pull-Down with Band', 'Strengthen latissimus dorsi with band', 'shoulder', 'strengthening', 'moderate', 'Secure band overhead. Kneel or stand. Pull band down to chest level with wide grip. Slowly return.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Row with Band', 'Strengthen middle back and posterior shoulder', 'shoulder', 'strengthening', 'beginner', 'Secure band at chest height. Pull band toward chest, squeezing shoulder blades. Slowly return.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cross-Body Shoulder Stretch', 'Stretch posterior shoulder capsule', 'shoulder', 'stretching', 'beginner', 'Bring arm across body at chest height. Use other hand to gently pull arm closer to chest. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Doorway Pec Stretch', 'Stretch pectoralis major and minor', 'shoulder', 'stretching', 'beginner', 'Stand in doorway with arm at 90 degrees on frame. Step forward until stretch is felt in chest. Hold. Repeat with arm at different heights.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Sleeper Stretch', 'Stretch posterior shoulder capsule and internal rotators', 'shoulder', 'stretching', 'moderate', 'Lie on involved side with shoulder and elbow at 90 degrees. Use other hand to gently push forearm toward floor. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Towel Internal Rotation Stretch', 'Stretch shoulder into internal rotation behind back', 'shoulder', 'stretching', 'moderate', 'Hold towel behind back with involved hand low and uninvolved hand high. Gently pull up with top hand. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Overhead Lat Stretch', 'Stretch latissimus dorsi and teres major', 'shoulder', 'stretching', 'beginner', 'Stand next to wall. Reach overhead arm up wall and lean body away. Feel stretch along side. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Pendulum Exercise', 'Gentle shoulder mobilization using gravity', 'shoulder', 'rom', 'beginner', 'Lean forward supporting yourself with uninvolved hand on table. Let involved arm hang. Gently swing arm in small circles, forward/back, side to side.', 2, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Wall Walk — Flexion', 'Progressive shoulder flexion ROM using wall', 'shoulder', 'rom', 'beginner', 'Face wall. Walk fingers up the wall as high as comfortable. Hold at top briefly. Walk back down.', 2, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Wall Walk — Abduction', 'Progressive shoulder abduction ROM using wall', 'shoulder', 'rom', 'beginner', 'Stand with involved side toward wall. Walk fingers up wall to the side as high as comfortable. Hold. Walk back down.', 2, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Supine Passive Flexion', 'Use uninvolved arm to assist flexion ROM', 'shoulder', 'rom', 'beginner', 'Lie on back. Hold wrist of involved arm. Use uninvolved arm to lift involved arm overhead as far as comfortable. Lower slowly.', 2, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Table Slide — Flexion', 'Gravity-assisted shoulder flexion on table surface', 'shoulder', 'rom', 'beginner', 'Sit at table with arm on towel. Slide arm forward across table as far as comfortable. Slide back.', 2, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Pulley Exercise', 'Use overhead pulley for assisted shoulder ROM', 'shoulder', 'rom', 'moderate', 'Sit under overhead pulley. Hold handles in both hands. Use uninvolved arm to pull rope, raising involved arm overhead. Slowly lower.', 2, 15, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Behind-Back IR with Towel', 'Improve internal rotation ROM using towel assist', 'shoulder', 'rom', 'moderate', 'Hold towel behind back. Uninvolved hand on top. Gently pull towel up to stretch involved shoulder into internal rotation.', 2, 10, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Thoracic Extension over Foam Roller', 'Mobilize thoracic spine into extension', 'thoracic', 'rom', 'beginner', 'Lie on foam roller positioned at mid-back. Support head with hands. Gently extend over roller. Move roller to different segments.', 3, 10, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cat-Cow Stretch', 'Mobilize thoracic spine through flexion and extension', 'thoracic', 'rom', 'beginner', 'On hands and knees. Arch back up like a cat (flexion). Then let belly drop and look up (extension). Move slowly.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Seated Thoracic Rotation', 'Improve thoracic rotation mobility', 'thoracic', 'rom', 'beginner', 'Sit with arms crossed over chest. Rotate trunk to one side as far as comfortable. Hold. Return and repeat to other side.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Thread the Needle', 'Improve thoracic rotation with arm reach', 'thoracic', 'rom', 'beginner', 'On hands and knees. Reach one arm under body toward opposite side, rotating trunk. Follow hand with eyes. Return and repeat.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Open Book Stretch', 'Side-lying thoracic rotation stretch', 'thoracic', 'stretching', 'beginner', 'Lie on side with knees bent and arms stacked. Open top arm rotating trunk back like opening a book. Follow hand with eyes. Return.', 3, 10, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Prone Press-Up', 'McKenzie extension exercise for thoracic spine', 'thoracic', 'rom', 'beginner', 'Lie face down. Place hands by shoulders. Press upper body up straightening arms while keeping hips on floor. Lower slowly.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Thoracic Extension with Arms Overhead', 'Strengthen thoracic extensors', 'thoracic', 'strengthening', 'moderate', 'Lie face down with arms extended overhead in Y. Lift arms and chest off floor. Hold. Lower slowly.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Scapular Wall Slide', 'Strengthen scapular stabilizers with thoracic control', 'thoracic', 'strengthening', 'moderate', 'Stand with back against wall. Arms in W position against wall. Slide arms up into Y position keeping contact with wall. Slide back down.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Foam Roller Snow Angels', 'Thoracic mobility with arm movement on roller', 'thoracic', 'rom', 'beginner', 'Lie lengthwise on foam roller. Make snow angel motions with arms, keeping them on the floor. Move slowly.', 2, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Seated Thoracic Extension', 'Self-mobilization of thoracic extension', 'thoracic', 'rom', 'beginner', 'Sit in chair. Clasp hands behind head. Gently extend backward over the back of the chair. Return to upright.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Prone Scapular Retraction', 'Strengthen mid-back extensors and scapular retractors', 'thoracic', 'strengthening', 'moderate', 'Lie face down with arms at sides. Squeeze shoulder blades together while lifting arms slightly. Hold. Lower.', 3, 12, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Quadruped Thoracic Rotation', 'Improve thoracic rotation in quadruped', 'thoracic', 'rom', 'beginner', 'On hands and knees. Place one hand behind head. Rotate that elbow toward ceiling, opening chest. Return. Repeat on other side.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Peanut Thoracic Mobilization', 'Use double lacrosse ball for segmental thoracic extension', 'thoracic', 'rom', 'moderate', 'Tape two tennis balls together. Lie on peanut at different thoracic levels. Extend over peanut with arms crossed. Move to next level.', 3, 5, 10, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Standing Thoracic Extension with Band', 'Resisted thoracic extension for posture', 'thoracic', 'strengthening', 'moderate', 'Hold band overhead with wide grip. Pull band apart and down behind head, squeezing shoulder blades. Slowly return overhead.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Pelvic Tilt', 'Activate deep core muscles with posterior pelvic tilt', 'lumbar', 'strengthening', 'beginner', 'Lie on back with knees bent. Flatten lower back against floor by tilting pelvis. Hold, then relax.', 3, 15, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Dead Bug', 'Core stabilization with opposite arm/leg movement', 'lumbar', 'strengthening', 'moderate', 'Lie on back. Arms up, knees bent 90 degrees. Slowly extend opposite arm and leg while maintaining flat back. Return. Alternate.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Bird-Dog', 'Core stabilization in quadruped with arm/leg extension', 'lumbar', 'strengthening', 'moderate', 'On hands and knees. Extend opposite arm and leg simultaneously. Hold briefly, keeping spine neutral. Return. Alternate sides.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Bridge', 'Strengthen glutes and lumbar extensors', 'lumbar', 'strengthening', 'beginner', 'Lie on back with knees bent, feet flat. Squeeze glutes and lift hips off floor until body is straight from shoulders to knees. Hold. Lower slowly.', 3, 15, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Side Plank', 'Strengthen obliques and lateral stabilizers', 'lumbar', 'strengthening', 'moderate', 'Lie on side with elbow under shoulder. Lift hips off floor creating straight line from head to feet. Hold. Lower. Repeat on other side.', 3, 3, 20, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Front Plank', 'Isometric core strengthening in prone position', 'lumbar', 'strengthening', 'moderate', 'On forearms and toes. Hold body in straight line from head to heels. Engage core, do not let hips sag. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Partial Curl-Up', 'Strengthen rectus abdominis with controlled flexion', 'lumbar', 'strengthening', 'beginner', 'Lie on back with knees bent. Cross arms over chest. Lift head and shoulders off floor. Hold briefly. Lower slowly.', 3, 15, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Prone Hip Extension', 'Strengthen lumbar extensors and gluteals', 'lumbar', 'strengthening', 'beginner', 'Lie face down. Squeeze one glute and lift leg straight up a few inches. Hold. Lower. Repeat on other side.', 3, 12, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Superman', 'Strengthen lumbar and thoracic extensors', 'lumbar', 'strengthening', 'moderate', 'Lie face down with arms extended overhead. Simultaneously lift arms and legs off floor. Hold. Lower slowly.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Pallof Press', 'Anti-rotation core exercise with band', 'lumbar', 'strengthening', 'moderate', 'Stand sideways to anchored band at chest height. Hold band at chest. Press arms straight out, resisting rotation. Hold. Return. Switch sides.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Double Knee to Chest', 'Stretch lumbar extensors and decompress spine', 'lumbar', 'stretching', 'beginner', 'Lie on back. Pull both knees toward chest. Hold, feeling stretch in lower back. Release.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Single Knee to Chest', 'Gentle unilateral lumbar flexion stretch', 'lumbar', 'stretching', 'beginner', 'Lie on back. Pull one knee toward chest while keeping other leg flat. Hold. Switch sides.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Child''s Pose', 'Resting stretch for lumbar spine', 'lumbar', 'stretching', 'beginner', 'Kneel and sit back on heels. Reach arms forward on floor, lowering chest toward thighs. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Prayer Stretch', 'Extended child''s pose with lateral emphasis', 'lumbar', 'stretching', 'beginner', 'From child''s pose, walk hands to one side to add lateral stretch. Hold. Walk to other side and hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Piriformis Stretch — Figure 4', 'Stretch piriformis to reduce sciatic tension', 'lumbar', 'stretching', 'beginner', 'Lie on back. Cross one ankle over opposite knee making figure 4. Pull bottom knee toward chest. Hold. Switch.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cat-Cow for Lumbar', 'Gentle lumbar flexion and extension mobility', 'lumbar', 'rom', 'beginner', 'On hands and knees. Arch back upward (cat). Then drop belly and look up (cow). Focus movement in lower back.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Lumbar Rotation Stretch', 'Supine trunk rotation for lumbar mobility', 'lumbar', 'rom', 'beginner', 'Lie on back with knees bent. Let both knees fall to one side while keeping shoulders flat. Hold. Switch sides.', 3, 3, 20, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Prone Press-Up (McKenzie)', 'Extension-based lumbar mobilization', 'lumbar', 'rom', 'beginner', 'Lie face down. Place hands by shoulders. Press upper body up straightening arms, keeping hips on floor. Hold briefly. Lower.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Standing Extension', 'Standing lumbar extension for flexion-biased pain', 'lumbar', 'rom', 'beginner', 'Stand with hands on lower back. Gently lean backward. Hold briefly. Return to upright.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Seated Lumbar Flexion', 'Seated forward bending for lumbar mobility', 'lumbar', 'rom', 'beginner', 'Sit in chair. Slowly bend forward reaching hands toward floor. Let spine round. Hold. Slowly return upright.', 3, 10, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Clamshell', 'Strengthen gluteus medius in side-lying', 'hip', 'strengthening', 'beginner', 'Lie on side with knees bent and feet together. Open top knee like a clamshell while keeping feet together. Hold. Slowly lower.', 3, 15, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Side-Lying Hip Abduction', 'Strengthen hip abductors in side-lying', 'hip', 'strengthening', 'beginner', 'Lie on side with bottom knee bent for support. Lift top leg straight up toward ceiling. Hold. Slowly lower.', 3, 15, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Standing Hip Abduction with Band', 'Resisted hip abduction in standing', 'hip', 'strengthening', 'moderate', 'Stand on one leg with band around ankles. Move other leg out to side against band resistance. Slowly return.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Hip Hike', 'Strengthen hip abductors and lateral trunk stabilizers', 'hip', 'strengthening', 'beginner', 'Stand on step with one leg hanging off edge. Drop hanging hip down, then hike it up above level. Repeat.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Monster Walk', 'Functional hip strengthening with band', 'hip', 'strengthening', 'moderate', 'Place band around ankles. Stand in slight squat. Walk sideways maintaining tension on band. Walk back.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Single Leg Bridge', 'Advanced glute strengthening', 'hip', 'strengthening', 'moderate', 'Lie on back with one knee bent, other leg extended. Lift hips using single leg. Hold at top. Lower slowly.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Fire Hydrant', 'Strengthen hip abductors and external rotators', 'hip', 'strengthening', 'beginner', 'On hands and knees. Lift one knee out to side keeping knee bent 90 degrees. Hold. Lower slowly.', 3, 15, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Straight Leg Raise — Supine', 'Strengthen hip flexors and quads', 'hip', 'strengthening', 'beginner', 'Lie on back with one knee bent, other straight. Tighten quad of straight leg and lift to height of bent knee. Hold. Lower slowly.', 3, 15, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Prone Hip Extension', 'Isolate gluteus maximus strengthening', 'hip', 'strengthening', 'beginner', 'Lie face down. Squeeze one glute and lift straight leg off surface a few inches. Hold. Lower. Switch sides.', 3, 12, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Standing Hip Extension with Band', 'Resisted hip extension in standing', 'hip', 'strengthening', 'moderate', 'Stand facing wall. Band around ankle, anchored forward. Extend leg backward against band. Slowly return.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Hip Flexor Stretch — Half Kneeling', 'Stretch iliopsoas in half-kneeling', 'hip', 'stretching', 'beginner', 'Kneel on one knee with opposite foot forward. Tuck pelvis under and shift weight forward until stretch is felt in front of hip. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Pigeon Stretch', 'Deep hip external rotation stretch', 'hip', 'stretching', 'moderate', 'From hands and knees, bring one knee forward and out. Extend other leg behind. Lower body toward floor. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Seated Figure 4 Stretch', 'Stretch piriformis and deep hip rotators', 'hip', 'stretching', 'beginner', 'Sit in chair. Cross one ankle over opposite knee. Lean forward at hips until stretch is felt. Hold. Switch.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Standing Quad Stretch', 'Stretch quadriceps and hip flexors', 'hip', 'stretching', 'beginner', 'Stand on one leg. Grab ankle of other leg and pull heel toward buttock. Keep knees together. Hold. Switch.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, '90-90 Hip Stretch', 'Stretch both internal and external hip rotators', 'hip', 'stretching', 'moderate', 'Sit with front leg bent 90 degrees, back leg bent 90 degrees behind. Lean forward over front leg. Hold. Switch sides.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Hip Flexion AROM', 'Active hip flexion range of motion', 'hip', 'rom', 'beginner', 'Lie on back. Slowly bring one knee toward chest as far as comfortable. Hold briefly. Return. Switch sides.', 2, 10, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Hip IR/ER in Sitting', 'Seated hip rotation ROM exercise', 'hip', 'rom', 'beginner', 'Sit on edge of chair with knees at 90 degrees. Rotate foot outward (internal rotation) and inward (external rotation). Repeat on other side.', 2, 10, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Hip Circles', 'Full hip ROM in standing', 'hip', 'rom', 'beginner', 'Stand on one leg. Make circles with other leg, moving through flexion, abduction, extension, adduction. Reverse direction. Switch legs.', 2, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Quad Set', 'Isometric quadriceps strengthening', 'knee', 'strengthening', 'beginner', 'Sit with leg extended. Tighten quad muscle pushing back of knee into surface. Hold. Relax.', 3, 15, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Short Arc Quad', 'Strengthen quads in limited ROM', 'knee', 'strengthening', 'beginner', 'Sit with rolled towel under knee. Straighten knee lifting foot off surface. Hold at top. Slowly lower.', 3, 15, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Terminal Knee Extension with Band', 'Strengthen quads in last degrees of extension', 'knee', 'strengthening', 'beginner', 'Loop band behind knee, anchored at knee height. Start slightly bent. Straighten knee against band resistance. Slowly bend back.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Straight Leg Raise — 4-Way', 'Strengthen muscles around knee in all planes', 'knee', 'strengthening', 'beginner', 'Lie on back: lift straight leg up (front). Roll to side: lift up (side). Roll to stomach: lift up (back). Roll to other side: lift (inner thigh).', 3, 10, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Wall Sit', 'Isometric quad and glute strengthening', 'knee', 'strengthening', 'moderate', 'Lean against wall with knees bent to 60-90 degrees. Hold position as if sitting in invisible chair. Keep back against wall.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Step-Up', 'Functional knee strengthening with step', 'knee', 'strengthening', 'moderate', 'Stand in front of step. Step up with involved leg, straightening fully on step. Step back down slowly with control.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Step-Down', 'Eccentric quad strengthening on step', 'knee', 'strengthening', 'moderate', 'Stand on step. Slowly lower uninvolved foot toward floor by bending involved knee. Tap floor lightly, then return to standing on step.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Mini Squat', 'Partial range squat for knee strengthening', 'knee', 'strengthening', 'beginner', 'Stand with feet shoulder-width apart. Bend knees to 45 degrees as if sitting back slightly. Keep weight on heels. Return to standing.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Hamstring Curl with Band', 'Strengthen hamstrings with band resistance', 'knee', 'strengthening', 'beginner', 'Stand facing wall. Band around ankle, anchored forward at floor. Curl heel toward buttock against band. Slowly lower.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Single Leg Squat to Chair', 'Advance single-leg strength', 'knee', 'strengthening', 'advanced', 'Stand on one leg in front of chair. Slowly lower to sit, controlling descent with one leg. Stand back up on one leg.', 3, 8, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Hamstring Stretch — Supine', 'Stretch hamstrings with strap assist', 'knee', 'stretching', 'beginner', 'Lie on back. Loop strap around foot. Raise leg keeping knee straight until stretch is felt behind thigh. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Standing Calf Stretch', 'Stretch gastrocnemius at wall', 'knee', 'stretching', 'beginner', 'Stand facing wall. Step one foot back keeping it straight and heel down. Lean into wall until stretch is felt in calf. Hold. Switch.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'IT Band Stretch — Standing', 'Stretch iliotibial band', 'knee', 'stretching', 'beginner', 'Stand with involved leg behind and crossed behind other leg. Lean away from involved side. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Quad Stretch — Prone', 'Stretch quadriceps in prone position', 'knee', 'stretching', 'beginner', 'Lie face down. Grab ankle and pull heel toward buttock. Hold. Use strap if needed.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Knee Flexion AROM — Seated', 'Active knee flexion range of motion', 'knee', 'rom', 'beginner', 'Sit in chair. Slowly bend knee sliding foot under chair as far as comfortable. Hold briefly. Straighten.', 2, 15, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Knee Extension AROM — Seated', 'Active knee extension range of motion', 'knee', 'rom', 'beginner', 'Sit in chair. Slowly straighten knee as far as possible. Hold briefly. Lower slowly.', 2, 15, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Heel Slide', 'Supine knee flexion ROM exercise', 'knee', 'rom', 'beginner', 'Lie on back. Slide heel toward buttock bending knee. Hold briefly. Slide back to straight.', 2, 15, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Stationary Bike', 'Low-impact knee ROM and conditioning', 'knee', 'rom', 'beginner', 'Ride stationary bike with low resistance. Start with partial revolutions if needed. Progress to full revolutions. 10-15 minutes.', 1, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Wrist Flexion with Weight', 'Strengthen wrist flexors', 'elbow_wrist', 'strengthening', 'beginner', 'Sit with forearm on table, palm up, wrist over edge. Hold light weight. Curl wrist upward. Slowly lower.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Wrist Extension with Weight', 'Strengthen wrist extensors', 'elbow_wrist', 'strengthening', 'beginner', 'Sit with forearm on table, palm down, wrist over edge. Hold light weight. Extend wrist upward. Slowly lower.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Pronation/Supination with Hammer', 'Strengthen forearm rotators', 'elbow_wrist', 'strengthening', 'beginner', 'Hold hammer or weighted stick at end. Rotate palm up (supination) then palm down (pronation). Move slowly.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Grip Strengthening — Ball Squeeze', 'Strengthen hand grip with ball', 'elbow_wrist', 'strengthening', 'beginner', 'Squeeze a soft ball or putty. Hold squeeze. Relax. Repeat.', 3, 15, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Eccentric Wrist Extension', 'Eccentric loading for lateral epicondylitis', 'elbow_wrist', 'strengthening', 'moderate', 'Support forearm palm down. Use uninvolved hand to assist wrist into extension. Slowly lower weight through wrist flexion using only involved hand.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Tyler Twist — FlexBar', 'Eccentric exercise for tennis elbow with flexible bar', 'elbow_wrist', 'strengthening', 'moderate', 'Hold FlexBar vertically. Twist with involved hand into extension. Extend both arms forward. Slowly release twist with involved hand.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Bicep Curl with Band', 'Strengthen biceps with band resistance', 'elbow_wrist', 'strengthening', 'beginner', 'Stand on band. Curl hand toward shoulder against band resistance. Slowly lower.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Tricep Extension with Band', 'Strengthen triceps overhead with band', 'elbow_wrist', 'strengthening', 'beginner', 'Hold band behind back. Top hand at shoulder. Press top hand straight up overhead. Slowly lower.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Wrist Flexor Stretch', 'Stretch forearm flexors', 'elbow_wrist', 'stretching', 'beginner', 'Extend arm with palm up. Use other hand to pull fingers down and back. Hold stretch.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Wrist Extensor Stretch', 'Stretch forearm extensors', 'elbow_wrist', 'stretching', 'beginner', 'Extend arm with palm down. Use other hand to push hand down and toward you. Hold stretch.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Elbow Flexion/Extension ROM', 'Active elbow ROM exercise', 'elbow_wrist', 'rom', 'beginner', 'Sit or stand. Slowly bend elbow fully, then straighten fully. Move through pain-free range.', 2, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Forearm Rotation ROM', 'Active pronation/supination ROM', 'elbow_wrist', 'rom', 'beginner', 'Bend elbow 90 degrees at side. Rotate palm up then palm down through full range. Move slowly.', 2, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Wrist Circles', 'Full wrist ROM in circular pattern', 'elbow_wrist', 'rom', 'beginner', 'Make slow circles with wrist in both directions. Keep forearm still. Move through full pain-free range.', 2, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Finger Tendon Glides', 'Improve finger tendon excursion', 'elbow_wrist', 'rom', 'beginner', 'Start with fingers straight. Make a hook fist (bend at middle joints). Then make a full fist. Then extend. Repeat.', 2, 10, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Nerve Glide — Median', 'Mobilize median nerve through upper extremity', 'elbow_wrist', 'rom', 'moderate', 'Start with arm at side, elbow bent. Extend wrist, then straighten elbow, then move arm out. Hold each position 3 seconds.', 2, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Nerve Glide — Ulnar', 'Mobilize ulnar nerve through upper extremity', 'elbow_wrist', 'rom', 'moderate', 'Start with arm at side. Extend wrist, supinate forearm, flex elbow, then abduct shoulder. Hold each position 3 seconds.', 2, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Ankle Dorsiflexion with Band', 'Strengthen tibialis anterior', 'ankle_foot', 'strengthening', 'beginner', 'Sit with leg extended. Loop band around foot, anchored forward. Pull foot up toward shin against band. Slowly point foot.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Ankle Plantarflexion — Calf Raise', 'Strengthen calf (gastrocnemius and soleus)', 'ankle_foot', 'strengthening', 'beginner', 'Stand on both feet. Rise up on toes as high as possible. Hold at top. Lower slowly with control.', 3, 15, 2, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Single Leg Calf Raise', 'Advanced unilateral calf strengthening', 'ankle_foot', 'strengthening', 'moderate', 'Stand on one foot on edge of step. Rise up on toes. Lower heel below step level. Rise back up.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Ankle Eversion with Band', 'Strengthen peroneal muscles', 'ankle_foot', 'strengthening', 'beginner', 'Sit with legs extended. Band around feet. Turn involved foot outward against band resistance. Slowly return.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Ankle Inversion with Band', 'Strengthen tibialis posterior', 'ankle_foot', 'strengthening', 'beginner', 'Sit with legs extended. Band around involved foot, anchored on same side. Turn foot inward against band. Slowly return.', 3, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Towel Curl', 'Strengthen intrinsic foot muscles', 'ankle_foot', 'strengthening', 'beginner', 'Sit with foot on towel on smooth floor. Scrunch towel toward you using toes. Spread towel out. Repeat.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Marble Pickup', 'Strengthen intrinsic foot muscles with fine motor', 'ankle_foot', 'strengthening', 'beginner', 'Place marbles on floor. Pick up one at a time with toes and place in cup. Use each foot.', 2, 15, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Heel Walk', 'Strengthen dorsiflexors functionally', 'ankle_foot', 'strengthening', 'moderate', 'Walk on heels only for 20 steps. Keep toes off the ground. Turn around and walk back.', 3, 2, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Toe Walk', 'Strengthen plantarflexors functionally', 'ankle_foot', 'strengthening', 'moderate', 'Walk on toes/balls of feet for 20 steps. Keep heels off ground. Turn and walk back.', 3, 2, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Calf Stretch — Gastrocnemius', 'Stretch gastrocnemius with straight knee', 'ankle_foot', 'stretching', 'beginner', 'Face wall. Step one foot back, keeping knee straight and heel on floor. Lean into wall. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Calf Stretch — Soleus', 'Stretch soleus with bent knee', 'ankle_foot', 'stretching', 'beginner', 'Face wall. Step one foot back, bend that knee keeping heel on floor. Lean into wall. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Plantar Fascia Stretch', 'Stretch plantar fascia and toe flexors', 'ankle_foot', 'stretching', 'beginner', 'Sit and cross involved foot over other knee. Pull toes back toward shin until stretch is felt on bottom of foot. Hold.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Frozen Water Bottle Roll', 'Self-massage and stretch for plantar fascia', 'ankle_foot', 'stretching', 'beginner', 'Sit with foot on frozen water bottle. Roll bottle under foot from heel to toes with moderate pressure.', 2, 1, 120, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Ankle Alphabet', 'Full ankle ROM exercise using alphabet tracing', 'ankle_foot', 'rom', 'beginner', 'Sit with foot off the ground. Trace the alphabet in the air with big toe. Use full range of ankle motion.', 1, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Ankle Circles', 'Ankle ROM in circular pattern', 'ankle_foot', 'rom', 'beginner', 'Sit with foot off ground. Make circles with foot in both directions. Move through full range.', 2, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Ankle Pumps', 'Active dorsiflexion/plantarflexion ROM', 'ankle_foot', 'rom', 'beginner', 'Lie down or sit with leg elevated. Pull foot up toward shin then point foot down. Repeat rhythmically.', 3, 20, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Single Leg Stance', 'Basic static balance on one leg', 'full_body', 'balance', 'beginner', 'Stand on one leg near counter for safety. Hold for time. Switch legs. Progress by closing eyes or standing on foam.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Tandem Stance', 'Narrowed base of support balance', 'full_body', 'balance', 'beginner', 'Stand with one foot directly in front of other, heel to toe. Hold position. Switch front foot.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Weight Shifting', 'Practice controlled weight transfer', 'full_body', 'balance', 'beginner', 'Stand with feet shoulder width apart. Slowly shift weight side to side. Then forward and back. Maintain control.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Tandem Walk', 'Dynamic balance walking heel-to-toe', 'full_body', 'balance', 'beginner', 'Walk in straight line placing heel directly in front of opposite toe with each step. Walk 20 steps. Turn and return.', 3, 2, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Single Leg Stance on Foam', 'Balance challenge on unstable surface', 'full_body', 'balance', 'moderate', 'Stand on foam pad on one leg. Hold position. Use counter for safety if needed. Switch legs.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'BOSU Ball Stance', 'Balance on unstable BOSU surface', 'full_body', 'balance', 'moderate', 'Stand on BOSU ball with both feet. Hold position with good posture. Progress to single leg.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Clock Reach', 'Dynamic balance reaching in multiple directions', 'full_body', 'balance', 'moderate', 'Stand on one leg. Reach other foot to 12, 3, 6, and 9 o''clock positions on imaginary clock. Return to center each time.', 3, 4, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Star Excursion Balance', 'Dynamic reaching balance test and exercise', 'full_body', 'balance', 'advanced', 'Stand on one leg. Reach other foot as far as possible in 8 directions (like a star). Return to center each time.', 3, 8, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Walking with Head Turns', 'Gaze stability during walking', 'full_body', 'balance', 'moderate', 'Walk in straight line while turning head side to side. Maintain straight path. Walk 30 feet. Turn and return.', 3, 2, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Backward Walking', 'Balance and proprioception during backward gait', 'full_body', 'balance', 'moderate', 'Walk backward slowly with good control. Use hallway or parallel bars for safety. Walk 20 steps.', 3, 2, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Lateral Walking', 'Sidestepping for lateral balance', 'full_body', 'balance', 'beginner', 'Sidestep to the right 10 steps, then sidestep left 10 steps. Maintain good posture and control.', 3, 2, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Sit to Stand — No Hands', 'Functional balance transition', 'full_body', 'balance', 'moderate', 'Sit in chair. Stand up without using hands. Slowly sit back down with control. Keep weight over feet.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Single Leg Stance Eyes Closed', 'Advanced proprioceptive balance challenge', 'full_body', 'balance', 'advanced', 'Stand on one leg with eyes closed. Stay near wall for safety. Hold as long as possible. Switch legs.', 3, 3, 15, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Foam Pad Tandem Stance', 'Tandem stance on foam for vestibular challenge', 'full_body', 'balance', 'moderate', 'Stand heel-to-toe on foam pad. Hold position. Switch front foot. Progress to eyes closed.', 3, 3, 30, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Squat', 'Functional bilateral lower body exercise', 'full_body', 'functional', 'moderate', 'Stand with feet shoulder-width apart. Lower as if sitting in chair. Keep knees behind toes. Weight on heels. Stand back up.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Lunge — Forward', 'Functional single-leg strengthening', 'full_body', 'functional', 'moderate', 'Step forward into lunge. Lower back knee toward floor. Keep front knee over ankle. Push back to standing. Alternate legs.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Lunge — Lateral', 'Side lunge for frontal plane strength', 'full_body', 'functional', 'moderate', 'Step to one side into wide stance. Bend stepping-side knee pushing hips back. Keep other leg straight. Push back to center.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Lunge — Reverse', 'Backward lunge for control and strength', 'full_body', 'functional', 'moderate', 'Step backward into lunge position. Lower back knee toward floor. Push back to standing. Alternate legs.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Romanian Deadlift', 'Hinge pattern strengthening for posterior chain', 'full_body', 'functional', 'moderate', 'Stand with slight knee bend. Hinge at hips lowering trunk forward while pushing hips back. Feel hamstring stretch. Return to standing.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Single Leg Deadlift', 'Balance and posterior chain strengthening', 'full_body', 'functional', 'advanced', 'Stand on one leg. Hinge at hip, extending other leg behind for balance. Lower trunk until parallel to floor. Return upright.', 3, 8, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Sit-to-Stand', 'Functional transfer training', 'full_body', 'functional', 'beginner', 'Sit in chair. Lean forward, push through feet to stand. Slowly lower back to sit. Use arms only if needed.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Step-Over Obstacles', 'Functional stepping and hip flexion', 'full_body', 'functional', 'moderate', 'Set up low obstacles in a line. Step over each one with good hip and knee flexion. Walk through course. Return.', 3, 2, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Farmer Carry', 'Grip, core, and postural endurance', 'full_body', 'functional', 'moderate', 'Hold weight in each hand at sides. Walk with good posture for 30-50 feet. Turn and return.', 3, 2, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Push-Up', 'Upper body functional strengthening', 'full_body', 'functional', 'moderate', 'Start in plank position. Lower chest toward floor bending elbows. Push back up. Modify on knees if needed.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Goblet Squat', 'Weighted squat pattern with counterbalance', 'full_body', 'functional', 'moderate', 'Hold weight at chest with both hands. Squat down keeping torso upright. Stand back up.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Stair Climbing', 'Functional stair training', 'full_body', 'functional', 'moderate', 'Walk up and down stairs with good form. Use rail as needed. Step over step pattern. 2-3 flights.', 3, 2, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Picking Up Objects', 'Proper body mechanics for floor reach', 'full_body', 'functional', 'beginner', 'Practice bending at hips and knees (not back) to pick up objects from floor. Use golfer''s lift for light items.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Overhead Reach with Weight', 'Functional overhead mobility and strength', 'full_body', 'functional', 'moderate', 'Hold light weight in both hands. Raise overhead with control. Lower to chest level. Repeat.', 3, 12, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Walking Program — Level 1', 'Beginner walking program for aerobic conditioning', 'full_body', 'cardio', 'beginner', 'Walk at comfortable pace for 10-15 minutes on flat surface. Gradually increase pace and duration as tolerated.', 1, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Walking Program — Level 2', 'Intermediate walking with incline', 'full_body', 'cardio', 'moderate', 'Walk at moderate pace for 20-30 minutes. Include some incline walking. Maintain conversational pace.', 1, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Walking Program — Level 3', 'Advanced walking/light jogging', 'full_body', 'cardio', 'advanced', 'Walk 30-45 minutes at brisk pace. May alternate 2 minutes jogging with 3 minutes walking if approved.', 1, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Recumbent Bike', 'Low-impact aerobic conditioning on recumbent bike', 'full_body', 'cardio', 'beginner', 'Ride recumbent bike at comfortable resistance for 10-20 minutes. Maintain RPE of 3-4 out of 10.', 1, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Upright Bike', 'Moderate aerobic conditioning on upright bike', 'full_body', 'cardio', 'moderate', 'Ride upright stationary bike at moderate resistance for 15-30 minutes. Maintain RPE of 4-5 out of 10.', 1, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Elliptical', 'Full-body low-impact aerobic exercise', 'full_body', 'cardio', 'moderate', 'Use elliptical machine at moderate pace for 15-25 minutes. Maintain good posture. Adjust resistance as tolerated.', 1, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Arm Ergometer', 'Upper body aerobic conditioning', 'full_body', 'cardio', 'beginner', 'Use arm ergometer (UBE) at low to moderate resistance for 10-15 minutes. Maintain comfortable pace.', 1, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Pool Walking', 'Aquatic aerobic exercise with buoyancy assist', 'full_body', 'cardio', 'beginner', 'Walk forward and backward in waist-deep pool for 15-20 minutes. Progress to deeper water and add arm movements.', 1, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Seated Marching', 'Low-level aerobic exercise for deconditioned patients', 'full_body', 'cardio', 'beginner', 'Sit in chair with good posture. March in place alternating lifting knees. Swing arms gently. Continue 5-10 minutes.', 1, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Step Aerobics — Low', 'Step-based aerobic conditioning', 'full_body', 'cardio', 'moderate', 'Use low step (4-6 inches). Step up and down alternating lead legs. Maintain moderate pace for 10-15 minutes.', 1, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Proprioceptive Alphabet', 'Ankle proprioception using alphabet tracing', 'ankle_foot', 'neuromuscular', 'beginner', 'Stand on one leg. Draw alphabet letters in air with other foot. Focus on control and accuracy.', 2, 1, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Ball Toss Single Leg', 'Dual-task balance with ball catch', 'full_body', 'neuromuscular', 'moderate', 'Stand on one leg. Toss ball against wall and catch. Progress to looking away between tosses.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Perturbation Training', 'Reactive balance training with partner', 'full_body', 'neuromuscular', 'moderate', 'Stand in athletic stance. Partner provides gentle unexpected pushes from different directions. React to maintain balance.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Agility Ladder — Lateral', 'Lateral agility and coordination', 'full_body', 'neuromuscular', 'moderate', 'Step laterally through agility ladder, one foot per box. Go through ladder, then return. Focus on quick, light feet.', 3, 2, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Agility Ladder — Forward', 'Forward agility and coordination', 'full_body', 'neuromuscular', 'moderate', 'Step through agility ladder going forward, two feet per box. Focus on quick, controlled foot placement.', 3, 2, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Cone Weave Walking', 'Directional change and motor planning', 'full_body', 'neuromuscular', 'beginner', 'Set up cones in zigzag pattern. Walk through weaving between cones. Walk through course and return.', 3, 2, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Reaction Ball Drill', 'Visual reaction time and agility', 'full_body', 'neuromuscular', 'moderate', 'Drop or bounce reaction ball (irregular shaped). Catch it after bounce. Progress to faster drops.', 3, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Mirror Exercise — Upper Extremity', 'Mirror therapy for motor recovery', 'full_body', 'neuromuscular', 'beginner', 'Place mirror along midline. Move uninvolved hand while watching reflection. Brain perceives involved hand moving.', 2, 10, 0, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Rhythmic Stabilization', 'PNF technique for joint stability', 'full_body', 'neuromuscular', 'moderate', 'Hold arm or leg in position. Therapist applies alternating rotational forces. Patient resists without moving. Progress force gradually.', 3, 10, 5, true, true) ON CONFLICT DO NOTHING;
INSERT INTO exercises (clinic_id, name, description, body_region, category, difficulty, instructions, default_sets, default_reps, default_hold_seconds, is_global, is_active) VALUES (NULL, 'Slow Reversal Hold', 'PNF pattern for neuromuscular coordination', 'full_body', 'neuromuscular', 'moderate', 'Move limb through PNF diagonal pattern. Pause and hold at mid-range. Reverse direction slowly. Repeat.', 3, 10, 3, true, true) ON CONFLICT DO NOTHING;

INSERT INTO _migrations (name) VALUES ('008_seed_exercises_and_features');

COMMIT;

-- ════════════════════════════════════════
-- MIGRATION COMPLETE
-- ════════════════════════════════════════
