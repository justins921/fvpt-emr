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
-- 3. Track this migration
-- ============================================================
INSERT INTO _migrations (name) VALUES ('009_schema_fixes') ON CONFLICT DO NOTHING;
