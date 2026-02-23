import { query } from '../db';

// ── Medicare Therapy Cap Thresholds ──
// Starting in 2018, the therapy cap was replaced by a threshold that
// triggers a KX modifier requirement. For 2024+, the threshold is $2,330
// for PT/OT combined and $2,330 for SLP. These amounts are updated
// annually by CMS and expressed here in cents.

const CAP_THRESHOLDS: Record<number, { ptOtCapCents: number; slpCapCents: number }> = {
  2024: { ptOtCapCents: 233000, slpCapCents: 233000 },
  2025: { ptOtCapCents: 233000, slpCapCents: 233000 },
  2026: { ptOtCapCents: 233000, slpCapCents: 233000 },
};

// Default for years not explicitly listed (use most recent known value)
const DEFAULT_CAP = { ptOtCapCents: 233000, slpCapCents: 233000 };

/**
 * Returns the Medicare therapy cap threshold for a given year.
 * PT and OT share a combined cap; SLP has its own separate cap.
 * Values are in cents.
 */
export function getTherapyCap(year: number): { ptOtCapCents: number; slpCapCents: number } {
  return CAP_THRESHOLDS[year] || DEFAULT_CAP;
}

export interface CapTrackingResult {
  ptOtCharges: number;
  slpCharges: number;
  ptOtCapReached: boolean;
  slpCapReached: boolean;
  kxRequired: boolean;
}

/**
 * Check the current therapy cap tracking for a patient within a clinic for
 * a given calendar year. Returns accumulated charges and whether the KX
 * modifier is required (charges have reached the cap threshold).
 */
export async function checkKxModifier(
  clinicId: string,
  patientId: string,
  year: number
): Promise<CapTrackingResult> {
  const caps = getTherapyCap(year);

  const result = await query(
    `SELECT pt_ot_charges_cents, slp_charges_cents
     FROM therapy_cap_tracking
     WHERE clinic_id = $1 AND patient_id = $2 AND year = $3`,
    [clinicId, patientId, year]
  );

  let ptOtCharges = 0;
  let slpCharges = 0;

  if (result.rows.length > 0) {
    ptOtCharges = result.rows[0].pt_ot_charges_cents;
    slpCharges = result.rows[0].slp_charges_cents;
  }

  const ptOtCapReached = ptOtCharges >= caps.ptOtCapCents;
  const slpCapReached = slpCharges >= caps.slpCapCents;

  return {
    ptOtCharges,
    slpCharges,
    ptOtCapReached,
    slpCapReached,
    kxRequired: ptOtCapReached || slpCapReached,
  };
}

/**
 * Upsert the therapy cap tracking record for a patient. Adds the specified
 * amounts (in cents) to the existing totals for the given calendar year.
 * If no record exists, one is created.
 */
export async function updateCapTracking(
  clinicId: string,
  patientId: string,
  year: number,
  addPtOtCents: number,
  addSlpCents: number
): Promise<void> {
  await query(
    `INSERT INTO therapy_cap_tracking (clinic_id, patient_id, year, pt_ot_charges_cents, slp_charges_cents)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (clinic_id, patient_id, year)
     DO UPDATE SET
       pt_ot_charges_cents = therapy_cap_tracking.pt_ot_charges_cents + $4,
       slp_charges_cents = therapy_cap_tracking.slp_charges_cents + $5,
       updated_at = NOW()`,
    [clinicId, patientId, year, addPtOtCents, addSlpCents]
  );
}
