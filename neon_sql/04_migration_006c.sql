-- Migration 006c: Locations, Portal, Payments, MIPS, FHIR, Therapy Cap + triggers

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

-- Triggers for all 006 tables
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

-- Add columns to existing tables
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES clinic_locations(id) ON DELETE SET NULL;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS referring_provider_id UUID REFERENCES referring_providers(id) ON DELETE SET NULL;

INSERT INTO _migrations (name) VALUES ('006_add_all_features');
