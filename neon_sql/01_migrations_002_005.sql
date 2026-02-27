-- Migrations 002-005: credential, username, dev role, messaging

-- 002: Add credential column
ALTER TABLE users ADD COLUMN credential VARCHAR(20) CHECK (credential IN ('PT','DPT','PTA','ATC','OT','SLP','MD','DO','NP','PA','Office'));

-- 003: username index (already correct from 001)
DROP INDEX IF EXISTS idx_users_email;
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 004: Add dev role
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

-- 005: SMS messaging
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

INSERT INTO _migrations (name) VALUES ('002_add_credential_to_users'), ('003_email_to_username'), ('004_add_dev_role_and_support'), ('005_add_messaging');
