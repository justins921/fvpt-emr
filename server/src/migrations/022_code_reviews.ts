/**
 * Migration 022 — documentation-to-code review storage (AI billing Phase 3).
 *
 * Adds the code_reviews table: stores LLM-assisted reviews that compare a
 * claim's CPT line items against the clinical note's documentation. Reviews
 * are immutable once created (new review = new row) so the audit trail of
 * what the model said, and when, is preserved.
 */
export async function up(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS code_reviews (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      note_id UUID REFERENCES clinical_notes(id) ON DELETE SET NULL,
      provider VARCHAR(20) NOT NULL,
      model VARCHAR(100) NOT NULL,
      results JSONB NOT NULL DEFAULT '{}',
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_code_reviews_claim ON code_reviews(claim_id);
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_code_reviews_clinic ON code_reviews(clinic_id);
  `);

  // ── Per-clinic AI configuration (BYOK) ──
  // Each clinic stores its OWN AI provider API key, encrypted at rest with
  // AES-256-GCM (AI_CONFIG_ENCRYPTION_KEY). One row per clinic.
  await client.query(`
    CREATE TABLE IF NOT EXISTS clinic_ai_config (
      clinic_id UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
      provider VARCHAR(20) NOT NULL CHECK (provider IN ('anthropic', 'openai')),
      encrypted_api_key TEXT NOT NULL,
      key_hint VARCHAR(24) NOT NULL DEFAULT '',
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function down(client: any): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS clinic_ai_config;`);
  await client.query(`DROP TABLE IF EXISTS code_reviews;`);
}
