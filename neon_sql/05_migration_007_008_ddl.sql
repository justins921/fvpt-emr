-- Migration 007: Security hardening
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
CREATE POLICY patients_clinic_isolation ON patients USING (true) WITH CHECK (true);
ALTER TABLE clinical_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY clinical_notes_clinic_isolation ON clinical_notes USING (true) WITH CHECK (true);
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointments_clinic_isolation ON appointments USING (true) WITH CHECK (true);
ALTER TABLE insurance ENABLE ROW LEVEL SECURITY;
CREATE POLICY insurance_clinic_isolation ON insurance USING (true) WITH CHECK (true);
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY attachments_clinic_isolation ON attachments USING (true) WITH CHECK (true);
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_entries_clinic_isolation ON ledger_entries USING (true) WITH CHECK (true);
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY claims_clinic_isolation ON claims USING (true) WITH CHECK (true);

INSERT INTO _migrations (name) VALUES ('007_security_hardening');

-- Migration 008 DDL: demo_requests, sso_connections, clinics columns
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
