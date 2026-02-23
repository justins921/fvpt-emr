import { PoolClient } from 'pg';

export async function up(client: PoolClient): Promise<void> {

  // ── Exercises (HEP Library) ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_exercises_clinic ON exercises(clinic_id);`);
  await client.query(`CREATE INDEX idx_exercises_body_region ON exercises(body_region);`);

  // ── Exercise Programs (HEP) ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_exercise_programs_clinic ON exercise_programs(clinic_id);`);
  await client.query(`CREATE INDEX idx_exercise_programs_patient ON exercise_programs(patient_id);`);

  // ── Exercise Program Items ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_program_items_program ON exercise_program_items(program_id);`);

  // ── HEP Adherence Tracking ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_hep_adherence_program ON hep_adherence_logs(program_id);`);

  // ── Plans of Care ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_poc_clinic ON plans_of_care(clinic_id);`);
  await client.query(`CREATE INDEX idx_poc_patient ON plans_of_care(patient_id);`);
  await client.query(`CREATE INDEX idx_poc_status ON plans_of_care(status);`);

  // ── Authorizations ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_authorizations_patient ON authorizations(patient_id);`);
  await client.query(`CREATE INDEX idx_authorizations_status ON authorizations(status);`);

  // ── Outcome Measures ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_outcome_measures_patient ON outcome_measures(patient_id);`);
  await client.query(`CREATE INDEX idx_outcome_measures_type ON outcome_measures(measure_type);`);

  // ── Intake Form Templates ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_intake_templates_clinic ON intake_form_templates(clinic_id);`);

  // ── Intake Form Submissions ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_intake_submissions_clinic ON intake_form_submissions(clinic_id);`);
  await client.query(`CREATE INDEX idx_intake_submissions_token ON intake_form_submissions(access_token);`);
  await client.query(`CREATE INDEX idx_intake_submissions_patient ON intake_form_submissions(patient_id);`);

  // ── Eligibility Checks ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_eligibility_patient ON eligibility_checks(patient_id);`);

  // ── Faxes ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_faxes_clinic ON faxes(clinic_id);`);
  await client.query(`CREATE INDEX idx_faxes_patient ON faxes(patient_id);`);

  // ── Referring Providers ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_referring_providers_clinic ON referring_providers(clinic_id);`);
  await client.query(`CREATE INDEX idx_referring_providers_npi ON referring_providers(npi);`);

  // ── Waitlist ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_waitlist_clinic ON waitlist_entries(clinic_id);`);
  await client.query(`CREATE INDEX idx_waitlist_status ON waitlist_entries(status);`);

  // ── Tasks ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_tasks_clinic ON tasks(clinic_id);`);
  await client.query(`CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);`);
  await client.query(`CREATE INDEX idx_tasks_status ON tasks(status);`);

  // ── Recall Campaigns ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_recall_campaigns_clinic ON recall_campaigns(clinic_id);`);

  // ── Recall Campaign Entries ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_recall_entries_campaign ON recall_entries(campaign_id);`);

  // ── Telehealth Sessions ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_telehealth_clinic ON telehealth_sessions(clinic_id);`);
  await client.query(`CREATE INDEX idx_telehealth_appointment ON telehealth_sessions(appointment_id);`);
  await client.query(`CREATE INDEX idx_telehealth_room ON telehealth_sessions(room_id);`);

  // ── Text Expanders / Smart Text ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_text_expanders_clinic ON text_expanders(clinic_id);`);
  await client.query(`CREATE INDEX idx_text_expanders_user ON text_expanders(user_id);`);

  // ── Workers Compensation Cases ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_wc_cases_clinic ON workers_comp_cases(clinic_id);`);
  await client.query(`CREATE INDEX idx_wc_cases_patient ON workers_comp_cases(patient_id);`);

  // ── Clinic Locations (Multi-Location) ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_clinic_locations_clinic ON clinic_locations(clinic_id);`);

  // ── Patient Portal Users ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_portal_users_clinic ON portal_users(clinic_id);`);
  await client.query(`CREATE INDEX idx_portal_users_patient ON portal_users(patient_id);`);

  // ── Portal Messages (Secure Messaging) ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_portal_messages_patient ON portal_messages(patient_id);`);

  // ── Payment Methods (Credit Card Tokens) ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_payment_methods_patient ON payment_methods(patient_id);`);

  // ── Payment Transactions ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_payment_transactions_patient ON payment_transactions(patient_id);`);

  // ── MIPS Quality Measures ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_mips_clinic ON mips_measures(clinic_id);`);
  await client.query(`CREATE INDEX idx_mips_provider ON mips_measures(provider_id);`);

  // ── FHIR Connections ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_fhir_connections_clinic ON fhir_connections(clinic_id);`);

  // ── FHIR Sync Log ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_fhir_sync_connection ON fhir_sync_log(connection_id);`);

  // ── KX Modifier / Therapy Cap Tracking ──
  await client.query(`
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
  `);
  await client.query(`CREATE INDEX idx_therapy_cap_patient ON therapy_cap_tracking(patient_id);`);

  // ── Apply updated_at triggers to new tables ──
  const tablesWithUpdatedAt = [
    'exercises', 'exercise_programs', 'plans_of_care', 'authorizations',
    'intake_form_templates', 'referring_providers', 'waitlist_entries',
    'tasks', 'recall_campaigns', 'telehealth_sessions', 'text_expanders',
    'workers_comp_cases', 'clinic_locations', 'portal_users', 'fhir_connections'
  ];

  for (const table of tablesWithUpdatedAt) {
    await client.query(`
      CREATE TRIGGER update_${table}_updated_at
      BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
  }

  // ── Add location_id to appointments for multi-location ──
  await client.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES clinic_locations(id) ON DELETE SET NULL;`);

  // ── Add referring_provider_id to patients ──
  await client.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS referring_provider_id UUID REFERENCES referring_providers(id) ON DELETE SET NULL;`);
}

export async function down(client: PoolClient): Promise<void> {
  // Remove added columns
  await client.query(`ALTER TABLE patients DROP COLUMN IF EXISTS referring_provider_id;`);
  await client.query(`ALTER TABLE appointments DROP COLUMN IF EXISTS location_id;`);

  // Drop tables in reverse dependency order
  const tables = [
    'fhir_sync_log', 'fhir_connections',
    'mips_measures',
    'payment_transactions', 'payment_methods',
    'portal_messages', 'portal_users',
    'clinic_locations',
    'workers_comp_cases',
    'text_expanders',
    'telehealth_sessions',
    'recall_entries', 'recall_campaigns',
    'tasks',
    'waitlist_entries',
    'referring_providers',
    'faxes',
    'eligibility_checks',
    'intake_form_submissions', 'intake_form_templates',
    'outcome_measures',
    'authorizations',
    'plans_of_care',
    'therapy_cap_tracking',
    'hep_adherence_logs', 'exercise_program_items', 'exercise_programs', 'exercises',
  ];

  for (const table of tables) {
    await client.query(`DROP TABLE IF EXISTS ${table} CASCADE;`);
  }
}
