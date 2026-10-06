import { query } from '../db';
import { parseERA } from './claims';

/**
 * Denial Pattern Mining — AI billing Phase 2.
 *
 * Learns denial patterns from ERA (835) history and scores pre-submission
 * claim risk, so billers see "this claim looks like the ones UHC denies"
 * BEFORE submitting instead of after.
 *
 * ── What counts as a "denial signal" ──────────────────────────────────────
 * X12 835 CAS group codes:
 *   CO = Contractual Obligation (payer contractual adjustment)
 *   OA = Other Adjustment
 *   PI = Payor Initiated reduction
 *   PR = Patient Responsibility (deductible/coinsurance/copay)
 *
 * A line carries a denial signal when it has CAS adjustments in the CO/OA/PI
 * families AND paid_amount == 0. Rationale: the payer adjudicated the line
 * but paid nothing on it — the classic denial shape. PR adjustments are NOT
 * denial signals: the payer processed the line, the balance just belongs to
 * the patient. Partial payments (paid > 0 with adjustments) are underpayments,
 * which is Phase 1's job, not this module's.
 *
 * Common PT denial reasons this surfaces: CO-96 (non-covered charge),
 * CO-97 (bundled/inclusive), CO-50 (non-covered service), CO-151, OA-121, etc.
 * The module is data-driven — it learns whatever reasons appear, not a
 * hardcoded list.
 *
 * ── Pattern semantics (read this before touching the upserts) ─────────────
 * One row = (scope, clinic, payer, CPT, diagnosis, reason).
 *   total_lines  = ERA lines observed for (payer, CPT, diagnosis) SINCE this
 *                  reason was first seen. (A new reason's denominator starts
 *                  at its first sighting; it self-corrects as lines arrive.
 *                  This is a documented approximation, not a bug.)
 *   denied_lines = of those, lines denied with THIS reason.
 *   denial_rate  = denied_lines / total_lines.
 * diagnosis_code = '' is the "any diagnosis" sentinel (avoids NULL-unique
 * issues; see migration 021).
 *
 * ── Risk scoring fallback chain (most specific → most general) ────────────
 * For each claim line (payer P, CPT C, diagnosis D):
 *   1. Clinic patterns for (P, C, D)          — this clinic's own history,
 *      most relevant to its payer mix and documentation habits.
 *   2. Clinic patterns for (P, C, '')         — this clinic, any diagnosis.
 *   3. Global patterns for (P, C, D)          — cross-clinic knowledge for
 *      combos this clinic hasn't seen enough of (see privacy rule below).
 *   4. Global patterns for (P, C, '')         — cross-clinic, any diagnosis.
 * The first level with any qualifying rows wins; levels are never mixed.
 * Rows need >= 5 samples to qualify for scoring; rows with 5–19 samples are
 * reported as low-confidence. Claim risk = max line risk (one risky line can
 * sink a claim).
 *
 * ── Cross-clinic privacy rule ──────────────────────────────────────────────
 * Global rows (scope='global', clinic_id NULL) may contain ONLY:
 * payer_name, cpt_code, diagnosis_code, reason_code, counts, rates,
 * contributing_clinics. NEVER clinic IDs, patient data, claim numbers,
 * dates, or anything traceable. A future rollup job may only publish a
 * global row with total_lines >= 50 AND contributing_clinks >= 3.
 */

// Minimum samples for a pattern to influence a risk score.
const MIN_SAMPLES_FOR_SCORING = 5;
// Samples below this are reported as low-confidence.
const LOW_CONFIDENCE_SAMPLES = 20;
// Minimum samples / contributing clinics for a global row to be published
// by the future rollup job (k-anonymity floor).
export const GLOBAL_MIN_SAMPLES = 50;
export const GLOBAL_MIN_CLINICS = 3;
// Clinic settings key for opting into anonymized cross-clinic contribution.
export const CONTRIBUTE_SETTING_KEY = 'contribute_anonymized_patterns';

// CAS group codes treated as denial-family (see header comment).
const DENIAL_GROUPS = new Set(['CO', 'OA', 'PI']);

export interface DenialPatternRow {
  id: string;
  scope: 'clinic' | 'global';
  clinic_id: string | null;
  payer_name: string;
  cpt_code: string;
  diagnosis_code: string;
  reason_code: string;
  total_lines: number;
  denied_lines: number;
  denial_rate: number;
  contributing_clinics: number;
  last_seen_at: string | null;
  updated_at: string;
}

export interface RiskExplanation {
  payerName: string;
  cptCode: string;
  diagnosisCode: string;
  reasonCode: string;
  denialRate: number;
  totalLines: number;
  deniedLines: number;
  level: string; // which fallback level produced this
  lowConfidence: boolean;
  crossClinic: boolean;
  text: string; // plain-language explanation
}

export interface LineRisk {
  cptCode: string;
  diagnosisCode: string;
  risk: number; // 0-100
  level: string | null;
  topPatterns: RiskExplanation[];
}

export interface ClaimRiskScore {
  claimId: string;
  score: number; // 0-100, max line risk
  band: 'low' | 'medium' | 'high';
  lines: LineRisk[];
}

export function riskBand(score: number): 'low' | 'medium' | 'high' {
  if (score >= 60) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

function normalizePayer(name: string | null | undefined): string {
  return (name || '').trim();
}

/** Clinic setting helper. Absent key = default ('false' for the opt-in flag). */
export async function getClinicSetting(
  clinicId: string,
  key: string,
  defaultValue = 'false'
): Promise<string> {
  const { rows } = await query(
    'SELECT value FROM clinic_settings WHERE clinic_id = $1 AND key = $2',
    [clinicId, key]
  );
  return rows.length > 0 ? rows[0].value : defaultValue;
}

export async function setClinicSetting(
  clinicId: string,
  key: string,
  value: string
): Promise<void> {
  await query(
    `INSERT INTO clinic_settings (clinic_id, key, value, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (clinic_id, key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [clinicId, key, value]
  );
}

/**
 * Learn denial patterns from one ERA file.
 * Safe to call repeatedly for the same ERA only via relearn (which wipes
 * clinic rows first); normal operation calls it once per ERA post.
 */
export async function learnFromERA(
  eraId: string,
  clinicId: string
): Promise<{ linesProcessed: number; patternsTouched: number }> {
  const eraRes = await query(
    'SELECT raw_content FROM era_files WHERE id = $1 AND clinic_id = $2',
    [eraId, clinicId]
  );
  if (eraRes.rows.length === 0) return { linesProcessed: 0, patternsTouched: 0 };

  const parsed = parseERA(eraRes.rows[0].raw_content);
  const payerName = normalizePayer(parsed.payerName);
  if (!payerName) return { linesProcessed: 0, patternsTouched: 0 };

  let linesProcessed = 0;
  let patternsTouched = 0;

  for (const eraClaim of parsed.claims) {
    // Enrich with diagnosis info from the matched DB claim (the 835 itself
    // carries no diagnosis pointers in our simplified parser).
    let diagByCpt: Record<string, string> = {};
    let dbPayer = '';
    try {
      const claimRes = await query(
        `SELECT c.diagnosis_codes, c.line_items, i.payer_name
         FROM claims c LEFT JOIN insurance i ON i.id = c.insurance_id
         WHERE c.clinic_id = $1 AND (c.claim_number = $2 OR c.id::text LIKE $3)
         LIMIT 1`,
        [clinicId, eraClaim.claimNumber, `${eraClaim.claimNumber}%`]
      );
      if (claimRes.rows.length > 0) {
        const db = claimRes.rows[0];
        dbPayer = normalizePayer(db.payer_name);
        const diags: string[] = db.diagnosis_codes || [];
        const items: any[] = Array.isArray(db.line_items) ? db.line_items : [];
        for (const item of items) {
          const ptr = Array.isArray(item.diagnosis_pointers) && item.diagnosis_pointers.length > 0
            ? item.diagnosis_pointers[0]
            : 1;
          if (item.cpt_code && diags[ptr - 1]) diagByCpt[item.cpt_code] = diags[ptr - 1];
        }
      }
    } catch {
      // Enrichment is best-effort; learning continues with diagnosis=''.
    }
    const payer = payerName || dbPayer;
    if (!payer) continue;

    for (const line of eraClaim.lineItems) {
      const cpt = (line.cptCode || '').trim();
      if (!cpt) continue;
      const diagnosis = diagByCpt[cpt] || '';
      // Distinct denial-family reasons on this line.
      const reasons = [...new Set(
        (line.denialReasons || [])
          .filter(r => DENIAL_GROUPS.has(r.groupCode) && r.amount > 0)
          .map(r => `${r.groupCode}-${r.reasonCode}`)
      )];
      const isDenialSignal = line.paidAmount === 0 && reasons.length > 0;
      linesProcessed++;

      if (isDenialSignal) {
        // Step 1: upsert the reason rows (total+1, denied+1).
        for (const reason of reasons) {
          const up = await query(
            `INSERT INTO denial_patterns
               (clinic_id, scope, payer_name, cpt_code, diagnosis_code, reason_code,
                total_lines, denied_lines, denial_rate, last_seen_at)
             VALUES ($1, 'clinic', $2, $3, $4, $5, 1, 1, 1.0, NOW())
             ON CONFLICT (clinic_id, payer_name, cpt_code, diagnosis_code, reason_code)
               WHERE scope = 'clinic'
             DO UPDATE SET
               total_lines = denial_patterns.total_lines + 1,
               denied_lines = denial_patterns.denied_lines + 1,
               denial_rate = (denial_patterns.denied_lines + 1)::decimal
                             / (denial_patterns.total_lines + 1),
               last_seen_at = NOW(),
               updated_at = NOW()
             RETURNING id`,
            [clinicId, payer, cpt, diagnosis, reason]
          );
          if (up.rows.length > 0) patternsTouched++;
        }
        // Step 2: bump denominators on the OTHER existing rows for this
        // (payer, CPT, diagnosis) — every observed line belongs in every
        // reason's denominator, but rows upserted in step 1 already counted it.
        await query(
          `UPDATE denial_patterns
           SET total_lines = total_lines + 1,
               denial_rate = denied_lines::decimal / (total_lines + 1),
               updated_at = NOW()
           WHERE scope = 'clinic' AND clinic_id = $1 AND payer_name = $2
             AND cpt_code = $3 AND diagnosis_code = $4
             AND NOT (reason_code = ANY($5))`,
          [clinicId, payer, cpt, diagnosis, reasons]
        );
      } else {
        // Clean line: belongs in every existing reason's denominator.
        await query(
          `UPDATE denial_patterns
           SET total_lines = total_lines + 1,
               denial_rate = denied_lines::decimal / (total_lines + 1),
               updated_at = NOW()
           WHERE scope = 'clinic' AND clinic_id = $1 AND payer_name = $2
             AND cpt_code = $3 AND diagnosis_code = $4`,
          [clinicId, payer, cpt, diagnosis]
        );
      }
    }
  }

  return { linesProcessed, patternsTouched };
}

/**
 * Rebuild a clinic's patterns from all posted ERAs. Wipes clinic-scoped rows
 * first so relearning is idempotent. Global rows are never touched.
 */
export async function relearnClinicPatterns(
  clinicId: string
): Promise<{ erasProcessed: number; linesProcessed: number }> {
  await query(
    `DELETE FROM denial_patterns WHERE scope = 'clinic' AND clinic_id = $1`,
    [clinicId]
  );
  const eras = await query(
    'SELECT id FROM era_files WHERE clinic_id = $1 AND posted = true ORDER BY posted_at',
    [clinicId]
  );
  let linesProcessed = 0;
  for (const era of eras.rows) {
    try {
      const r = await learnFromERA(era.id, clinicId);
      linesProcessed += r.linesProcessed;
    } catch (err) {
      console.error('Denial pattern relearn failed for ERA', era.id, err);
    }
  }
  return { erasProcessed: eras.rows.length, linesProcessed };
}

// ── FUTURE: Cross-clinic global pattern rollup ─────────────────────────────
// Hook point for a scheduled job (NOT built yet). When built, it must:
//   1. Select clinic-scoped patterns only from clinics where
//      clinic_settings.contribute_anonymized_patterns = 'true' (opt-in).
//   2. Aggregate into scope='global' rows: SUM(total_lines), SUM(denied_lines),
//      recompute denial_rate, COUNT(DISTINCT clinic_id) AS contributing_clinics.
//   3. Publish a global row ONLY when total_lines >= GLOBAL_MIN_SAMPLES (50)
//      AND contributing_clinics >= GLOBAL_MIN_CLINICS (3) — k-anonymity floor.
//   4. Global rows contain ONLY (payer, CPT, diagnosis, reason, counts, rates).
//      clinic_id stays NULL. No patient data ever enters this table.
// Until that job exists, scoring falls back gracefully when no global rows
// exist (levels 3-4 of the fallback chain simply find nothing).

interface CandidateRow extends DenialPatternRow {
  confidence: number;
  weighted: number;
}

/**
 * Score pre-submission denial risk for a claim.
 * Reads the claim's payer (via insurance), CPTs and diagnoses, then walks
 * the fallback chain per line. Never throws for missing data — returns a
 * zero score with empty explanations when nothing is known.
 */
export async function scoreClaimRisk(
  claimId: string,
  clinicId: string
): Promise<ClaimRiskScore> {
  const empty: ClaimRiskScore = { claimId, score: 0, band: 'low', lines: [] };
  const claimRes = await query(
    `SELECT c.diagnosis_codes, c.line_items, i.payer_name
     FROM claims c LEFT JOIN insurance i ON i.id = c.insurance_id
     WHERE c.id = $1 AND c.clinic_id = $2`,
    [claimId, clinicId]
  );
  if (claimRes.rows.length === 0) return empty;
  const claim = claimRes.rows[0];
  const payer = normalizePayer(claim.payer_name);
  const diags: string[] = claim.diagnosis_codes || [];
  const items: any[] = Array.isArray(claim.line_items) ? claim.line_items : [];
  if (!payer || items.length === 0) return empty;

  const levels: Array<{ label: string; scope: 'clinic' | 'global'; crossClinic: boolean }> = [
    { label: 'clinic-specific (exact diagnosis)', scope: 'clinic', crossClinic: false },
    { label: 'clinic-specific (any diagnosis)', scope: 'clinic', crossClinic: false },
    { label: 'cross-clinic (exact diagnosis)', scope: 'global', crossClinic: true },
    { label: 'cross-clinic (any diagnosis)', scope: 'global', crossClinic: true },
  ];

  const lines: LineRisk[] = [];
  let maxRisk = 0;

  for (const item of items) {
    const cpt = String(item.cpt_code || '').trim();
    if (!cpt) continue;
    const ptr = Array.isArray(item.diagnosis_pointers) && item.diagnosis_pointers.length > 0
      ? item.diagnosis_pointers[0] : 1;
    const diagnosis = diags[ptr - 1] || '';

    let lineRisk: LineRisk = { cptCode: cpt, diagnosisCode: diagnosis, risk: 0, level: null, topPatterns: [] };

    for (let li = 0; li < levels.length; li++) {
      const level = levels[li];
      const diagKey = li % 2 === 0 ? diagnosis : '';
      const rows = await fetchLevelRows(clinicId, level.scope, payer, cpt, diagKey);
      if (rows.length === 0) continue;
      // First level with qualifying rows wins.
      const top = rows.slice(0, 3).map(r => toExplanation(r, level, payer, cpt, diagnosis));
      const best = rows[0];
      lineRisk = {
        cptCode: cpt,
        diagnosisCode: diagnosis,
        risk: Math.round(best.weighted * 100),
        level: level.label,
        topPatterns: top,
      };
      break;
    }

    lines.push(lineRisk);
    if (lineRisk.risk > maxRisk) maxRisk = lineRisk.risk;
  }

  return { claimId, score: maxRisk, band: riskBand(maxRisk), lines };
}

async function fetchLevelRows(
  clinicId: string,
  scope: 'clinic' | 'global',
  payer: string,
  cpt: string,
  diagnosis: string
): Promise<CandidateRow[]> {
  const where =
    scope === 'clinic'
      ? `scope = 'clinic' AND clinic_id = $1 AND payer_name = $2 AND cpt_code = $3 AND diagnosis_code = $4`
      : `scope = 'global' AND payer_name = $1 AND cpt_code = $2 AND diagnosis_code = $3`;
  const params = scope === 'clinic' ? [clinicId, payer, cpt, diagnosis] : [payer, cpt, diagnosis];
  const { rows } = await query(
    `SELECT *, LEAST(1.0, total_lines::decimal / ${LOW_CONFIDENCE_SAMPLES}) AS confidence
     FROM denial_patterns
     WHERE ${where} AND total_lines >= ${MIN_SAMPLES_FOR_SCORING}
     ORDER BY denial_rate DESC, total_lines DESC`,
    params
  );
  return rows.map((r: any) => ({
    ...r,
    denial_rate: parseFloat(r.denial_rate),
    confidence: parseFloat(r.confidence),
    weighted: parseFloat(r.denial_rate) * parseFloat(r.confidence),
  }));
}

function toExplanation(
  r: CandidateRow,
  level: { label: string; crossClinic: boolean },
  payer: string,
  cpt: string,
  diagnosis: string
): RiskExplanation {
  const diagText = diagnosis ? ` with ${diagnosis}` : '';
  const lowConfidence = r.total_lines < LOW_CONFIDENCE_SAMPLES;
  return {
    payerName: r.payer_name,
    cptCode: r.cpt_code,
    diagnosisCode: r.diagnosis_code,
    reasonCode: r.reason_code,
    denialRate: r.denial_rate,
    totalLines: r.total_lines,
    deniedLines: r.denied_lines,
    level: level.label,
    lowConfidence,
    crossClinic: level.crossClinic,
    text:
      `${r.payer_name} denied ${r.cpt_code}${diagText} (${r.reason_code}) on ` +
      `${r.denied_lines} of ${r.total_lines} lines ` +
      `(${(r.denial_rate * 100).toFixed(0)}% denial rate)` +
      (lowConfidence ? ` — low confidence, only ${r.total_lines} lines observed` : '') +
      (level.crossClinic ? ' — based on anonymized cross-clinic data' : ''),
  };
}
