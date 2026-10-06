import { z } from 'zod';
import { query } from '../db';
import { getLLMProviderForClinic } from './aiConfig';
import { LLMError } from './llm';
import { logAudit } from './audit';
import { AuditAction } from '../types';
import { parseERA } from './claims';

/**
 * AI billing Phase 4 — denial appeal drafts.
 *
 * An LLM drafts a payer appeal letter for a denied claim, grounded in the
 * clinical note (medical-necessity quotes) and the ERA denial reason codes
 * (point-by-point rebuttal). The draft is assistive only: the biller reviews,
 * edits, and marks it sent. Nothing is ever auto-sent.
 *
 * Reuses the Phase 3 LLM plumbing exactly: per-clinic BYOK via
 * getLLMProviderForClinic, 503 when unconfigured, no prompt/completion
 * logging. The letter itself legitimately contains patient identifiers
 * (name, DOB, member ID) because it is addressed to the payer — unlike the
 * Phase 3 code review, we do NOT strip identifiers here; we pass only the
 * identifiers the letter requires and instruct the model to invent nothing.
 */

export interface DenialReason {
  source: 'era' | 'manual';
  cpt_code: string | null;
  reason_code: string | null;
  description: string | null;
  paid_cents: number;
  billed_cents: number;
}

export interface AppealDraft {
  id: string;
  claim_id: string;
  note_id: string | null;
  denial_reasons: DenialReason[];
  draft_text: string;
  provider: string;
  model: string;
  status: 'draft' | 'edited' | 'sent';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const manualDenialSchema = z.object({
  cpt_code: z.string().max(10).optional().nullable(),
  reason_code: z.string().max(20).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
});

const draftRequestSchema = z.object({
  denial_reasons: z.array(manualDenialSchema).max(20).optional().default([]),
});

const updateDraftSchema = z.object({
  draft_text: z.string().min(1).max(20000).optional(),
  status: z.enum(['draft', 'edited', 'sent']).optional(),
});

const SYSTEM_PROMPT = `You are drafting a formal appeal letter to a health insurance payer for a denied physical therapy claim. Write in a professional, factual, respectful tone.

LETTER STRUCTURE (use exactly these sections):
1. Header block with placeholders: [PRACTICE NAME], [PRACTICE ADDRESS], [NPI], [CONTACT NAME], [CONTACT PHONE], [DATE]
2. "Re:" line: patient name, date of birth, member ID, dates of service, claim number — use ONLY the values provided below; never invent or guess any of these.
3. Opening paragraph: state this is a first-level appeal of the denied claim, listing the denied CPT codes and billed amounts.
4. Medical necessity argument: explain why the denied services were medically necessary, citing EXACT quoted phrases from the clinical note (provided below). Every clinical assertion must be tied to a quoted phrase. Never invent symptoms, findings, or treatments not present in the note.
5. Reason-by-reason rebuttal: address each denial reason code listed below individually. For each, explain why it does not apply, grounded in the note and the billed codes.
6. Closing: respectfully request reconsideration and payment, note willingness to provide additional records.

STRICT RULES:
- Use ONLY the patient/clinic/claim facts provided below. If a fact is missing, use its [PLACEHOLDER] — never invent names, dates, numbers, or clinical details.
- Quote the clinical note verbatim when asserting medical necessity; do not paraphrase inside quotation marks.
- Do not use threatening, emotional, or legalistic language.
- End with a line: "--- / This is an AI-generated draft. Review and edit before sending."

Return the letter as plain text only. No markdown fences, no JSON, no commentary outside the letter. Output the complete letter exactly once — do not repeat, summarize, or provide alternate versions.`;

function cents(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '$0.00';
  return `$${(Number(n) / 100).toFixed(2)}`;
}

function buildNoteText(note: any): string {
  const parts: string[] = [];
  if (note.note_type) parts.push(`Note type: ${note.note_type}`);
  if (note.subjective) parts.push(`SUBJECTIVE:\n${note.subjective}`);
  if (note.objective) parts.push(`OBJECTIVE:\n${note.objective}`);
  if (note.assessment) parts.push(`ASSESSMENT:\n${note.assessment}`);
  if (note.plan) parts.push(`PLAN:\n${note.plan}`);
  if (note.treatment_time_minutes) parts.push(`Treatment time: ${note.treatment_time_minutes} minutes`);
  return parts.join('\n\n');
}

/** Collect denial reasons from the claim's ERA (if posted) plus manual entries. */
async function collectDenialReasons(
  claim: any,
  clinicId: string,
  manual: Array<z.infer<typeof manualDenialSchema>>
): Promise<DenialReason[]> {
  const reasons: DenialReason[] = [];

  // Manual entries first (biller knows best).
  for (const m of manual) {
    reasons.push({
      source: 'manual',
      cpt_code: m.cpt_code || null,
      reason_code: m.reason_code || null,
      description: m.description || null,
      paid_cents: 0,
      billed_cents: 0,
    });
  }

  // ERA-sourced denials: match the claim by claim number in the parsed 835.
  if (claim.era_id && claim.claim_number) {
    try {
      const eraRes = await query('SELECT raw_content FROM era_files WHERE id = $1 AND clinic_id = $2', [
        claim.era_id,
        clinicId,
      ]);
      if (eraRes.rows.length > 0) {
        const parsed = parseERA(eraRes.rows[0].raw_content);
        const eraClaim = parsed.claims.find((c: any) => c.claimNumber === claim.claim_number);
        if (eraClaim) {
          for (const item of eraClaim.lineItems || []) {
            if (item.paidAmount === 0 && (item.denialReason || item.adjustmentAmount > 0)) {
              reasons.push({
                source: 'era',
                cpt_code: item.cptCode || null,
                reason_code: item.denialReason || null,
                description: null,
                paid_cents: Math.round(item.paidAmount || 0),
                billed_cents: Math.round(item.chargeAmount || 0),
              });
            }
          }
        }
      }
    } catch {
      // ERA parse failures shouldn't block drafting; manual reasons still work.
    }
  }

  return reasons;
}

function buildUserPrompt(opts: {
  patientName: string;
  patientDob: string;
  memberId: string;
  payerName: string;
  claimNumber: string;
  serviceDate: string;
  lineItems: Array<{ cpt_code: string; units: number; charge_cents: number }>;
  diagnosisCodes: string[];
  denialReasons: DenialReason[];
  noteText: string;
}): string {
  const lines = opts.lineItems
    .map((l) => `- ${l.cpt_code} x${l.units ?? 1}: ${cents(l.charge_cents)}`)
    .join('\n');

  const denials =
    opts.denialReasons.length > 0
      ? opts.denialReasons
          .map(
            (d, i) =>
              `${i + 1}. [${d.source}] CPT ${d.cpt_code || 'n/a'}, reason code ${d.reason_code || 'n/a'}${
                d.description ? ` — ${d.description}` : ''
              } (billed ${cents(d.billed_cents)}, paid ${cents(d.paid_cents)})`
          )
          .join('\n')
      : '(no specific denial reason codes provided — address the denial generally)';

  return `CLAIM FACTS (use exactly as given; use [PLACEHOLDER] for anything missing):
Patient: ${opts.patientName}
Date of birth: ${opts.patientDob}
Member ID: ${opts.memberId}
Payer: ${opts.payerName}
Claim number: ${opts.claimNumber}
Date(s) of service: ${opts.serviceDate}
Diagnosis codes: ${opts.diagnosisCodes.length > 0 ? opts.diagnosisCodes.join(', ') : '[DIAGNOSIS CODES]'}
Billed line items:
${lines || '(none listed)'}

DENIAL REASONS TO REBUT:
${denials}

CLINICAL NOTE (cite verbatim quotes from this for medical necessity):
---
${opts.noteText}
---

Draft the appeal letter now. Plain text only.`;
}

/**
 * Draft an appeal letter for a denied claim.
 * Throws LLMError on provider/config/data problems. Never logs note text.
 */
export async function draftAppeal(
  claimId: string,
  clinicId: string,
  userId: string,
  body: unknown
): Promise<AppealDraft> {
  const provider = await getLLMProviderForClinic(clinicId);
  if (!provider) {
    throw new LLMError('LLM not configured — set LLM_PROVIDER and the API key.', 503);
  }

  const parsed = draftRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new LLMError('Invalid input', 400);
  }

  const claimRes = await query('SELECT * FROM claims WHERE id = $1 AND clinic_id = $2', [claimId, clinicId]);
  if (claimRes.rows.length === 0) {
    throw new LLMError('Claim not found', 404);
  }
  const claim = claimRes.rows[0];

  if (!claim.note_id) {
    throw new LLMError('Claim has no linked clinical note to base the appeal on', 422);
  }

  const noteRes = await query(
    'SELECT id, note_type, subjective, objective, assessment, plan, treatment_time_minutes FROM clinical_notes WHERE id = $1 AND clinic_id = $2',
    [claim.note_id, clinicId]
  );
  if (noteRes.rows.length === 0) {
    throw new LLMError('Linked clinical note not found', 404);
  }
  const note = noteRes.rows[0];
  const noteText = buildNoteText(note);
  if (noteText.trim().length < 50) {
    throw new LLMError('Clinical note has too little content to draft an appeal', 422);
  }

  // Patient + payer context for the letter header.
  const patientRes = await query(
    'SELECT first_name, last_name, date_of_birth FROM patients WHERE id = $1 AND clinic_id = $2',
    [claim.patient_id, clinicId]
  );
  const patient = patientRes.rows[0] || {};
  let payerName = '[PAYER]';
  let memberId = '[MEMBER ID]';
  if (claim.insurance_id) {
    const insRes = await query('SELECT payer_name, member_id FROM insurance WHERE id = $1', [claim.insurance_id]);
    if (insRes.rows.length > 0) {
      payerName = insRes.rows[0].payer_name || payerName;
      memberId = insRes.rows[0].member_id || memberId;
    }
  }

  const denialReasons = await collectDenialReasons(claim, clinicId, parsed.data.denial_reasons);
  // A draft is still useful with manual context even if no coded reasons exist;
  // require at least a denied status or some denial signal to avoid nonsense drafts.
  const hasDenialSignal = claim.status === 'denied' || denialReasons.length > 0;
  if (!hasDenialSignal) {
    throw new LLMError('Claim is not denied and no denial reasons were provided', 422);
  }

  const lineItems = Array.isArray(claim.line_items)
    ? claim.line_items.map((l: any) => ({
        cpt_code: String(l.cpt_code || ''),
        units: Number(l.units ?? 1),
        charge_cents: Number(l.charge_cents ?? l.charge_amount_cents ?? 0),
      }))
    : [];

  const userPrompt = buildUserPrompt({
    patientName: patient.first_name ? `${patient.last_name}, ${patient.first_name}` : '[PATIENT NAME]',
    patientDob: patient.date_of_birth ? String(patient.date_of_birth).substring(0, 10) : '[DOB]',
    memberId,
    payerName,
    claimNumber: claim.claim_number || claim.payer_claim_number || '[CLAIM NUMBER]',
    serviceDate: claim.service_date ? String(claim.service_date).substring(0, 10) : '[SERVICE DATE]',
    lineItems,
    diagnosisCodes: Array.isArray(claim.diagnosis_codes) ? claim.diagnosis_codes : [],
    denialReasons,
    noteText,
  });

  const draftText = await provider.complete(SYSTEM_PROMPT, userPrompt);
  if (!draftText || draftText.trim().length < 100) {
    throw new LLMError('LLM returned an unusable draft', 502);
  }

  const insertRes = await query(
    `INSERT INTO appeal_drafts (clinic_id, claim_id, note_id, denial_reasons, draft_text, provider, model, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8)
     RETURNING id, claim_id, note_id, denial_reasons, draft_text, provider, model, status, created_by, created_at, updated_at`,
    [
      clinicId,
      claimId,
      note.id,
      JSON.stringify(denialReasons),
      draftText.trim(),
      provider.name,
      provider.model,
      userId,
    ]
  );

  await logAudit({
    clinicId,
    userId,
    action: AuditAction.APPEAL_DRAFT_CREATED,
    resourceType: 'claim',
    resourceId: claimId,
    details: { model: provider.model, denialReasons: denialReasons.length },
  });

  return rowToDraft(insertRes.rows[0]);
}

function rowToDraft(row: any): AppealDraft {
  return {
    id: row.id,
    claim_id: row.claim_id,
    note_id: row.note_id,
    denial_reasons: Array.isArray(row.denial_reasons) ? row.denial_reasons : [],
    draft_text: row.draft_text,
    provider: row.provider,
    model: row.model,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/** List drafts for a claim, newest first. */
export async function getAppealDrafts(claimId: string, clinicId: string): Promise<AppealDraft[]> {
  const res = await query(
    `SELECT d.*, u.first_name AS author_first, u.last_name AS author_last
     FROM appeal_drafts d
     LEFT JOIN users u ON u.id = d.created_by
     WHERE d.claim_id = $1 AND d.clinic_id = $2
     ORDER BY d.created_at DESC`,
    [claimId, clinicId]
  );
  return res.rows.map((r: any) => ({
    ...rowToDraft(r),
    author_name: r.author_first ? `${r.author_last}, ${r.author_first}` : null,
  }));
}

/** Edit draft text and/or advance status. Only the owning clinic's drafts. */
export async function updateAppealDraft(
  draftId: string,
  clinicId: string,
  userId: string,
  body: unknown
): Promise<AppealDraft> {
  const parsed = updateDraftSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new LLMError('Invalid input', 400);
  }
  if (parsed.data.draft_text === undefined && parsed.data.status === undefined) {
    throw new LLMError('Nothing to update', 400);
  }

  const existing = await query('SELECT * FROM appeal_drafts WHERE id = $1 AND clinic_id = $2', [draftId, clinicId]);
  if (existing.rows.length === 0) {
    throw new LLMError('Appeal draft not found', 404);
  }
  const current = existing.rows[0];

  // Status may only move forward: draft -> edited -> sent.
  const order = ['draft', 'edited', 'sent'];
  const newStatus = parsed.data.status ?? current.status;
  if (order.indexOf(newStatus) < order.indexOf(current.status)) {
    throw new LLMError('Draft status cannot move backwards', 400);
  }
  // Editing text implicitly moves draft -> edited unless already sent.
  const effectiveStatus =
    parsed.data.draft_text !== undefined && current.status === 'draft' && newStatus === 'draft'
      ? 'edited'
      : newStatus;

  const res = await query(
    `UPDATE appeal_drafts
     SET draft_text = COALESCE($1, draft_text), status = $2, updated_at = NOW()
     WHERE id = $3 AND clinic_id = $4
     RETURNING *`,
    [parsed.data.draft_text ?? null, effectiveStatus, draftId, clinicId]
  );

  await logAudit({
    clinicId,
    userId,
    action:
      effectiveStatus === 'sent' ? AuditAction.APPEAL_DRAFT_SENT : AuditAction.APPEAL_DRAFT_EDITED,
    resourceType: 'appeal_draft',
    resourceId: draftId,
    details: { claim_id: current.claim_id, status: effectiveStatus },
  });

  return rowToDraft(res.rows[0]);
}
