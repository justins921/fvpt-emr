/**
 * Underpayment detection engine (AI billing Phase 1).
 *
 * Compares what a payer actually paid per ERA line item against the clinic's
 * contracted rate (fee schedule) for that CPT. Flags lines where the payer
 * came up short. Lines with no contracted rate on file are reported as
 * "missing rate" — never flagged as underpaid, since we can't judge what
 * we don't know.
 */
import { query } from '../db';

export const DEFAULT_UNDERPYMT_THRESHOLD_CENTS = 100; // $1 — ignore penny noise

export interface UnderpaymentLine {
  claimId: string;
  /** Payer name from the claim's insurance record, or the ERA payer name. */
  payerName: string | null;
  cptCode: string;
  billedCents: number;
  paidCents: number;
  eraId?: string | null;
}

export interface MissingRate {
  claimId: string;
  cptCode: string;
}

export interface DetectionResult {
  flagged: number;
  updated: number;
  skippedMissingRate: MissingRate[];
}

/** Normalize payer names for matching (ERA text vs staff-entered names). */
function normPayer(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toUpperCase();
  return n.length ? n : null;
}

export async function getThresholdCents(clinicId: string): Promise<number> {
  const { rows } = await query(
    `SELECT value FROM clinic_settings WHERE clinic_id = $1 AND key = 'underpayment_threshold_cents'`,
    [clinicId]
  );
  const v = parseInt(rows[0]?.value ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_UNDERPYMT_THRESHOLD_CENTS;
}

export async function setThresholdCents(clinicId: string, cents: number): Promise<void> {
  await query(
    `INSERT INTO clinic_settings (clinic_id, key, value, updated_at)
     VALUES ($1, 'underpayment_threshold_cents', $2, NOW())
     ON CONFLICT (clinic_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [clinicId, String(Math.max(0, Math.round(cents)))]
  );
}

/**
 * Contracted allowed amount (cents) for a CPT: payer-specific schedule first,
 * then the clinic default schedule. Most recent effective_date wins.
 * Returns null when no rate is on file.
 */
export async function getContractedRateCents(
  clinicId: string,
  payerName: string | null,
  cptCode: string
): Promise<number | null> {
  const payer = normPayer(payerName);
  if (payer) {
    const { rows } = await query(
      `SELECT fsi.allowed_amount_cents
       FROM fee_schedule_items fsi
       JOIN fee_schedules fs ON fs.id = fsi.schedule_id
       WHERE fs.clinic_id = $1 AND fs.is_active = true
         AND UPPER(TRIM(fs.payer_name)) = $2
         AND fsi.cpt_code = $3
       ORDER BY fs.effective_date DESC NULLS LAST
       LIMIT 1`,
      [clinicId, payer, cptCode]
    );
    if (rows.length > 0) return rows[0].allowed_amount_cents;
  }
  const { rows } = await query(
    `SELECT fsi.allowed_amount_cents
     FROM fee_schedule_items fsi
     JOIN fee_schedules fs ON fs.id = fsi.schedule_id
     WHERE fs.clinic_id = $1 AND fs.is_active = true
       AND fs.payer_name IS NULL
       AND fsi.cpt_code = $2
     ORDER BY fs.effective_date DESC NULLS LAST
     LIMIT 1`,
    [clinicId, cptCode]
  );
  return rows.length > 0 ? rows[0].allowed_amount_cents : null;
}

/**
 * Run detection over ERA line items. Flags (or refreshes) underpayment_flags
 * rows for lines paid below the contracted rate by at least the threshold.
 * Existing open/in_review flags are refreshed; resolved/appealed/wont_pursue
 * flags are left alone.
 */
export async function detectUnderpayments(
  clinicId: string,
  lines: UnderpaymentLine[]
): Promise<DetectionResult> {
  const threshold = await getThresholdCents(clinicId);
  let flagged = 0;
  let updated = 0;
  const skippedMissingRate: MissingRate[] = [];

  for (const line of lines) {
    if (!line.cptCode || !line.claimId) continue;
    const allowed = await getContractedRateCents(clinicId, line.payerName, line.cptCode);
    if (allowed === null) {
      skippedMissingRate.push({ claimId: line.claimId, cptCode: line.cptCode });
      continue;
    }
    const shortfall = allowed - line.paidCents;
    if (shortfall < threshold) continue;

    const existing = await query(
      `SELECT id, status FROM underpayment_flags
       WHERE clinic_id = $1 AND claim_id = $2 AND cpt_code = $3`,
      [clinicId, line.claimId, line.cptCode]
    );

    if (existing.rows.length === 0) {
      await query(
        `INSERT INTO underpayment_flags
           (clinic_id, claim_id, cpt_code, billed_cents, allowed_cents, paid_cents,
            shortfall_cents, status, era_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8)`,
        [
          clinicId, line.claimId, line.cptCode,
          Math.round(line.billedCents), allowed, Math.round(line.paidCents),
          shortfall, line.eraId ?? null,
        ]
      );
      flagged++;
    } else if (existing.rows[0].status === 'open' || existing.rows[0].status === 'in_review') {
      await query(
        `UPDATE underpayment_flags
         SET billed_cents = $2, allowed_cents = $3, paid_cents = $4,
             shortfall_cents = $5, era_id = COALESCE($6, era_id), updated_at = NOW()
         WHERE id = $1`,
        [
          existing.rows[0].id,
          Math.round(line.billedCents), allowed, Math.round(line.paidCents),
          shortfall, line.eraId ?? null,
        ]
      );
      updated++;
    }
    // resolved / appealed / wont_pursue: leave the human's decision alone
  }

  return { flagged, updated, skippedMissingRate };
}
