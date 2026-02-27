-- Migration 006a: HEP, Plans of Care, Authorizations, Outcome Measures, Intake Forms

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
