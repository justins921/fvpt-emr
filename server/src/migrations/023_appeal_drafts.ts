/**
 * Migration 023 — denial appeal drafts (AI billing Phase 4).
 *
 * Adds the appeal_drafts table: stores LLM-drafted payer appeal letters for
 * denied claims. Drafts are editable — the biller reviews, edits, and marks
 * sent. Nothing is ever auto-sent; the draft is assistive only.
 *
 * Status workflow: draft → edited → sent. A claim can have multiple drafts
 * (e.g. re-drafted after new information); the latest is the working copy.
 */
export async function up(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS appeal_drafts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      claim_id UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      note_id UUID REFERENCES clinical_notes(id) ON DELETE SET NULL,
      denial_reasons JSONB NOT NULL DEFAULT '[]',
      draft_text TEXT NOT NULL,
      provider VARCHAR(20) NOT NULL,
      model VARCHAR(100) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'edited', 'sent')),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_appeal_drafts_claim ON appeal_drafts(claim_id);
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_appeal_drafts_clinic ON appeal_drafts(clinic_id);
  `);
}

export async function down(client: any): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS appeal_drafts;`);
}
