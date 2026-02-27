-- 09_schema_fixes.sql
-- Fix schema mismatches between code and database
-- Run this against the Neon database to fix Telehealth, FHIR, and Exercise features

-- ============================================================
-- 1. Add dev support account to FVPT clinic
-- ============================================================
DO $$
DECLARE
  v_clinic_id UUID;
  v_hash TEXT;
BEGIN
  SELECT id INTO v_clinic_id FROM clinics WHERE npi = '1639574820';
  IF v_clinic_id IS NOT NULL THEN
    -- Password: SobDev2024!  (bcrypt hash)
    v_hash := '$2b$12$LzN3n8X.dXEwqJ0vZz1Q3.B5yz3GK8qC5wHQd8vYx1sR0VnZ6XKXW';
    INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role)
    VALUES (v_clinic_id, 'jsob', v_hash, 'Justin', 'Sobojinski', 'dev')
    ON CONFLICT (clinic_id, username) DO UPDATE SET role = 'dev';
    RAISE NOTICE 'Dev account jsob created/updated for FVPT clinic';
  END IF;
END $$;

-- ============================================================
-- 2. Exercises table: ensure clinic_id allows NULL for global exercises
-- ============================================================
ALTER TABLE exercises ALTER COLUMN clinic_id DROP NOT NULL;

-- ============================================================
-- 3. Fix HEP schema mismatches — add missing columns
-- ============================================================

-- exercises: add missing columns
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS default_duration_minutes INT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- exercise_programs: add missing columns
ALTER TABLE exercise_programs ADD COLUMN IF NOT EXISTS duration_weeks INT;
ALTER TABLE exercise_programs ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE exercise_programs ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE exercise_programs ADD COLUMN IF NOT EXISTS source_template_id UUID REFERENCES exercise_programs(id) ON DELETE SET NULL;

-- exercise_program_items: add missing columns
ALTER TABLE exercise_program_items ADD COLUMN IF NOT EXISTS duration_minutes INT;
ALTER TABLE exercise_program_items ADD COLUMN IF NOT EXISTS resistance VARCHAR(100);

-- hep_adherence_logs: add missing columns
ALTER TABLE hep_adherence_logs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE hep_adherence_logs ADD COLUMN IF NOT EXISTS completion_percent INT DEFAULT 0;
ALTER TABLE hep_adherence_logs ADD COLUMN IF NOT EXISTS difficulty_rating VARCHAR(20);
ALTER TABLE hep_adherence_logs ADD COLUMN IF NOT EXISTS logged_by UUID REFERENCES users(id);

-- Rename integer exercises_completed to exercises_completed_count (if it's still an INT)
-- Then add UUID[] exercises_completed column expected by routes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hep_adherence_logs' AND column_name = 'exercises_completed' AND data_type = 'integer'
  ) THEN
    ALTER TABLE hep_adherence_logs RENAME COLUMN exercises_completed TO exercises_completed_count;
    ALTER TABLE hep_adherence_logs ADD COLUMN exercises_completed UUID[] NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- ============================================================
-- 4. Track migrations
-- ============================================================
INSERT INTO _migrations (name) VALUES ('009_schema_fixes') ON CONFLICT DO NOTHING;
INSERT INTO _migrations (name) VALUES ('009_fix_hep_schema') ON CONFLICT DO NOTHING;
