-- Migration 006b: Faxes, Referring Providers, Waitlist, Tasks, Recall, Telehealth, etc.

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
