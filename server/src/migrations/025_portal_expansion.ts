/**
 * Migration 025 — patient portal expansion: self-registration support.
 *
 * Adds:
 * - clinic_portal_settings: per-clinic master switch for patient self-registration.
 * - clinics.portal_code: short human-friendly code patients enter at sign-up
 *   to identify their clinic (easier than a UUID). Generated for existing
 *   clinics from the clinic name + random digits.
 *
 * No third-party services required.
 */
export async function up(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS clinic_portal_settings (
      clinic_id UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
      allow_patient_self_registration BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Backfill: one settings row per existing clinic (registration allowed by default).
  await client.query(`
    INSERT INTO clinic_portal_settings (clinic_id)
    SELECT id FROM clinics
    ON CONFLICT (clinic_id) DO NOTHING;
  `);

  // Short human-friendly clinic code for self-registration.
  await client.query(`
    ALTER TABLE clinics
    ADD COLUMN IF NOT EXISTS portal_code VARCHAR(12) UNIQUE;
  `);

  // Generate codes for clinics that don't have one yet:
  // first 3 letters of the name (alphanumeric, uppercased) + 4 random digits.
  const existing = await client.query(`SELECT id, name FROM clinics WHERE portal_code IS NULL`);
  for (const row of existing.rows) {
    const prefix = (String(row.name).replace(/[^a-zA-Z]/g, '').substring(0, 3) || 'CLN').toUpperCase();
    let code = '';
    let attempts = 0;
    // Retry on the (unlikely) collision — portal_code has a UNIQUE constraint.
    while (attempts < 10) {
      code = `${prefix}${Math.floor(1000 + Math.random() * 9000)}`;
      try {
        await client.query(`UPDATE clinics SET portal_code = $1 WHERE id = $2`, [code, row.id]);
        break;
      } catch {
        attempts += 1;
      }
    }
  }

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_clinics_portal_code ON clinics(portal_code);
  `);
}

export async function down(client: any): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS clinic_portal_settings;`);
  await client.query(`ALTER TABLE clinics DROP COLUMN IF EXISTS portal_code;`);
}
