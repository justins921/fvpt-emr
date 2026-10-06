import { z } from 'zod';
import { query } from '../db';
import { getLLMProviderForClinic } from './aiConfig';
import { LLMError, stripIdentifiers } from './llm';
import { logAudit } from './audit';
import { AuditAction } from '../types';

/**
 * AI billing Phase 3 — documentation-to-code matching.
 *
 * An LLM reads the clinical note behind a claim and lists the CPT codes the
 * documentation supports (with verbatim quotes). The service compares that
 * against the claim's actual line items:
 *   - claimed but unsupported  → audit risk
 *   - documented but unclaimed → lost revenue
 *
 * This is assistive, never authoritative: the therapist makes the final call.
 */

// ── LLM response schema ──────────────────────────────────────────────

const documentedCodeSchema = z.object({
  cpt_code: z.string().regex(/^\d{5}$/),
  confidence: z.enum(['high', 'medium', 'low']),
  justification: z.string().min(1).max(1000),
  quotes: z.array(z.string().min(1).max(500)).max(5),
});

const llmResponseSchema = z.object({
  documented_codes: z.array(documentedCodeSchema).max(30),
});

type DocumentedCode = z.infer<typeof documentedCodeSchema>;

export interface CodeReviewLineResult {
  cpt_code: string;
  line_number: number | null;
  units: number | null;
  verdict: 'supported' | 'questionable' | 'unsupported';
  confidence: 'high' | 'medium' | 'low' | null;
  justification: string | null;
  quotes: string[];
}

export interface UnbilledSuggestion {
  cpt_code: string;
  confidence: 'high' | 'medium' | 'low';
  justification: string;
  quotes: string[];
}

export interface CodeReviewResult {
  claim_id: string;
  note_id: string | null;
  provider: string;
  model: string;
  reviewed_at: string;
  line_results: CodeReviewLineResult[];
  unbilled_suggestions: UnbilledSuggestion[];
  summary: {
    supported: number;
    questionable: number;
    unsupported: number;
    unbilled: number;
  };
}

const SYSTEM_PROMPT = `You are a physical therapy coding assistant. You read a clinical note (SOAP format) and identify which CPT procedure codes the documentation supports.

RULES — follow these exactly:
1. Quote EXACT phrases from the note that support each code. Never paraphrase in the quotes field; use the note's own words.
2. Never list a CPT code unless the note text directly supports it. When in doubt, leave it out or mark confidence "low".
3. Use standard outpatient physical therapy CPT knowledge:
   - 97110 therapeutic exercise (strengthening, ROM, gait training with exercise)
   - 97112 neuromuscular re-education (balance, coordination, proprioception, PNF)
   - 97116 gait training (specific gait instruction, not general ambulation)
   - 97140 manual therapy (joint mobilization, soft tissue mobilization, manipulation)
   - 97530 therapeutic activities (functional/dynamic activities, lifting, carrying)
   - 97161-97163 physical therapy evaluation (complexity levels)
   - 97164 re-evaluation
   - 97014/97032/G0283 electrical stimulation (attended vs unattended matters)
   - 97035 ultrasound, 97124 massage
4. Timed codes require documented time or clear description of the intervention duration. Do not assume time that is not documented.
5. An evaluation code (97161-97163) is supported only if the note is an evaluation with examination elements documented.
6. Return STRICT JSON only, no markdown fences, no commentary. Schema:
{"documented_codes": [{"cpt_code": "97110", "confidence": "high", "justification": "one sentence", "quotes": ["exact phrase from note"]}]}`;

function buildUserPrompt(noteText: string, claimedCpts: string[]): string {
  return `Clinical note (identifiers redacted):
---
${noteText}
---

CPT codes currently on the claim: ${claimedCpts.length > 0 ? claimedCpts.join(', ') : '(none)'}

List every CPT code this documentation supports, with quotes. Return strict JSON only.`;
}

function buildNoteText(note: any): string {
  const parts: string[] = [];
  if (note.note_type) parts.push(`Note type: ${note.note_type}`);
  if (note.subjective) parts.push(`SUBJECTIVE:\n${note.subjective}`);
  if (note.objective) parts.push(`OBJECTIVE:\n${note.objective}`);
  if (note.assessment) parts.push(`ASSESSMENT:\n${note.assessment}`);
  if (note.plan) parts.push(`PLAN:\n${note.plan}`);
  if (note.treatment_time_minutes) parts.push(`Treatment time: ${note.treatment_time_minutes} minutes`);
  if (note.eval_data) {
    try {
      parts.push(`Evaluation data: ${JSON.stringify(note.eval_data).substring(0, 2000)}`);
    } catch { /* ignore */ }
  }
  return stripIdentifiers(parts.join('\n\n'));
}

function extractJson(text: string): unknown {
  // Tolerate markdown fences in case the model adds them despite instructions.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new LLMError('LLM returned a non-JSON response', 502);
  }
  try {
    return JSON.parse(raw.substring(start, end + 1));
  } catch {
    throw new LLMError('LLM returned malformed JSON', 502);
  }
}

/**
 * Run a documentation-to-code review for a claim.
 * Throws LLMError when the provider is unconfigured or the call fails.
 * Never logs note text.
 */
export async function runCodeReview(
  claimId: string,
  clinicId: string,
  userId: string
): Promise<CodeReviewResult> {
  const provider = await getLLMProviderForClinic(clinicId);
  if (!provider) {
    throw new LLMError('LLM not configured — set LLM_PROVIDER and the API key.', 503);
  }

  const claimRes = await query('SELECT * FROM claims WHERE id = $1 AND clinic_id = $2', [claimId, clinicId]);
  if (claimRes.rows.length === 0) {
    throw new LLMError('Claim not found', 404);
  }
  const claim = claimRes.rows[0];

  if (!claim.note_id) {
    throw new LLMError('Claim has no linked clinical note to review against', 422);
  }

  const noteRes = await query(
    'SELECT id, note_type, subjective, objective, assessment, plan, eval_data, treatment_time_minutes FROM clinical_notes WHERE id = $1 AND clinic_id = $2',
    [claim.note_id, clinicId]
  );
  if (noteRes.rows.length === 0) {
    throw new LLMError('Linked clinical note not found', 404);
  }
  const note = noteRes.rows[0];

  const lineItems: Array<{ line_number: number; cpt_code: string; units: number }> =
    Array.isArray(claim.line_items) ? claim.line_items : [];
  const claimedCpts = [...new Set(lineItems.map((l) => String(l.cpt_code)).filter(Boolean))];

  const noteText = buildNoteText(note);
  if (noteText.trim().length < 50) {
    throw new LLMError('Clinical note has too little content to review', 422);
  }

  const raw = await provider.complete(SYSTEM_PROMPT, buildUserPrompt(noteText, claimedCpts));
  const parsed = llmResponseSchema.safeParse(extractJson(raw));
  if (!parsed.success) {
    throw new LLMError('LLM response did not match the expected schema', 502);
  }
  const documented: DocumentedCode[] = parsed.data.documented_codes;

  // ── Comparison ──
  const docByCode = new Map<string, DocumentedCode>();
  for (const d of documented) {
    const existing = docByCode.get(d.cpt_code);
    if (!existing || rankConfidence(d.confidence) > rankConfidence(existing.confidence)) {
      docByCode.set(d.cpt_code, d);
    }
  }

  const line_results: CodeReviewLineResult[] = lineItems.map((item) => {
    const cpt = String(item.cpt_code);
    const doc = docByCode.get(cpt);
    let verdict: CodeReviewLineResult['verdict'];
    if (!doc) verdict = 'unsupported';
    else if (doc.confidence === 'high') verdict = 'supported';
    else if (doc.confidence === 'medium') verdict = 'questionable';
    else verdict = 'unsupported';
    return {
      cpt_code: cpt,
      line_number: item.line_number ?? null,
      units: item.units ?? null,
      verdict,
      confidence: doc?.confidence ?? null,
      justification: doc?.justification ?? null,
      quotes: doc?.quotes ?? [],
    };
  });

  const claimedSet = new Set(claimedCpts);
  const unbilled_suggestions: UnbilledSuggestion[] = documented
    .filter((d) => !claimedSet.has(d.cpt_code))
    .map((d) => ({
      cpt_code: d.cpt_code,
      confidence: d.confidence,
      justification: d.justification,
      quotes: d.quotes,
    }));

  const result: CodeReviewResult = {
    claim_id: claimId,
    note_id: note.id,
    provider: provider.name,
    model: provider.model,
    reviewed_at: new Date().toISOString(),
    line_results,
    unbilled_suggestions,
    summary: {
      supported: line_results.filter((l) => l.verdict === 'supported').length,
      questionable: line_results.filter((l) => l.verdict === 'questionable').length,
      unsupported: line_results.filter((l) => l.verdict === 'unsupported').length,
      unbilled: unbilled_suggestions.length,
    },
  };

  // ── Persist (immutable row per review) ──
  await query(
    `INSERT INTO code_reviews (clinic_id, claim_id, note_id, provider, model, results, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [clinicId, claimId, note.id, provider.name, provider.model, JSON.stringify(result), userId]
  );

  await logAudit({
    clinicId,
    userId,
    action: AuditAction.CODE_REVIEW_RUN,
    resourceType: 'claim',
    resourceId: claimId,
    details: {
      model: provider.model,
      supported: result.summary.supported,
      unsupported: result.summary.unsupported,
      unbilled: result.summary.unbilled,
    },
  });

  return result;
}

function rankConfidence(c: 'high' | 'medium' | 'low'): number {
  return c === 'high' ? 3 : c === 'medium' ? 2 : 1;
}

/** Latest stored review for a claim (no LLM call). */
export async function getLatestCodeReview(claimId: string, clinicId: string): Promise<CodeReviewResult | null> {
  const res = await query(
    `SELECT results FROM code_reviews WHERE claim_id = $1 AND clinic_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [claimId, clinicId]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].results as CodeReviewResult;
}
