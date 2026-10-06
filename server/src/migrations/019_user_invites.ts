/**
 * Migration 019 — staff invite-based onboarding.
 *
 * Adds the user_invites table: single-use, expiring invite tokens (stored as
 * SHA-256 hashes) that let an admin invite a new hire by email. The invitee
 * accepts via a public link and sets their own password — no more
 * admin-chosen passwords.
 */
export async function up(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_invites (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL
        CHECK (role IN ('owner','admin','dev','therapist','front_desk','biller','read_only')),
      invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_user_invites_token ON user_invites(token_hash);
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_user_invites_clinic ON user_invites(clinic_id);
  `);
}

export async function down(client: any): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS user_invites;`);
}
