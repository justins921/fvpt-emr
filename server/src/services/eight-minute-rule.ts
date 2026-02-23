import { TimedCPTEntry, EightMinuteRuleResult } from '../types';

// ── Timed CPT Codes (require direct one-on-one contact) ──
export const TIMED_CPT_CODES: Record<string, string> = {
  '97110': 'Therapeutic exercise',
  '97112': 'Neuromuscular re-education',
  '97116': 'Gait training',
  '97140': 'Manual therapy',
  '97530': 'Therapeutic activities',
  '97535': 'Self-care/home management training',
  '97542': 'Wheelchair management',
  '97750': 'Physical performance test',
};

// ── Untimed / Service-Based CPT Codes (billed per encounter, not per unit) ──
export const UNTIMED_CPT_CODES: Record<string, string> = {
  '97161': 'PT evaluation - low complexity',
  '97162': 'PT evaluation - moderate complexity',
  '97163': 'PT evaluation - high complexity',
  '97164': 'PT re-evaluation',
  '97010': 'Hot/cold packs',
  '97014': 'Electrical stimulation (unattended)',
  '97018': 'Paraffin bath',
  '97012': 'Mechanical traction',
};

/**
 * Applies the Medicare 8-Minute Rule to calculate billable units.
 *
 * For a single timed code:
 *   8-22 min = 1 unit, 23-37 = 2 units, 38-52 = 3 units, 53-67 = 4 units, etc.
 *   General formula: units = Math.floor((minutes + 7) / 15)
 *   But the minimum threshold is 8 minutes (below 8 = 0 units).
 *
 * For mixed (multiple) timed codes:
 *   1. Calculate total minutes across all timed codes.
 *   2. Total allowable units = Math.floor(totalMinutes / 15).
 *   3. Each code gets at least Math.floor(codeMinutes / 15) units (its "base" units).
 *   4. Remaining units (total - sum of base units) are distributed to codes
 *      with the highest remainders (minutes % 15), in descending order.
 *   5. A code must have at least 8 minutes of remainder to qualify for a
 *      remainder-based unit.
 */
export function calculateUnits(entries: TimedCPTEntry[]): EightMinuteRuleResult {
  if (entries.length === 0) {
    return { entries: [], totalMinutes: 0, totalUnits: 0 };
  }

  // Group minutes by CPT code
  const grouped = new Map<string, number>();
  for (const entry of entries) {
    const current = grouped.get(entry.cptCode) || 0;
    grouped.set(entry.cptCode, current + entry.minutes);
  }

  const codeEntries = Array.from(grouped.entries()).map(([cptCode, minutes]) => ({
    cptCode,
    minutes,
    units: 0,
  }));

  const totalMinutes = codeEntries.reduce((sum, e) => sum + e.minutes, 0);

  // If total time is less than 8 minutes, no units are billable
  if (totalMinutes < 8) {
    return {
      entries: codeEntries,
      totalMinutes,
      totalUnits: 0,
    };
  }

  // Single code path: apply standard 8-minute rule directly
  if (codeEntries.length === 1) {
    const entry = codeEntries[0];
    entry.units = singleCodeUnits(entry.minutes);
    return {
      entries: codeEntries,
      totalMinutes,
      totalUnits: entry.units,
    };
  }

  // Mixed codes path
  const totalAllowableUnits = Math.floor(totalMinutes / 15);

  // Step 1: Assign base units (full 15-minute blocks) to each code
  for (const entry of codeEntries) {
    entry.units = Math.floor(entry.minutes / 15);
  }

  const baseUnitsSum = codeEntries.reduce((sum, e) => sum + e.units, 0);
  let remainingUnits = totalAllowableUnits - baseUnitsSum;

  // Step 2: Distribute remaining units by remainder (descending), with 8-min threshold
  if (remainingUnits > 0) {
    const withRemainders = codeEntries
      .map((entry) => ({
        entry,
        remainder: entry.minutes % 15,
      }))
      .filter((r) => r.remainder >= 8)
      .sort((a, b) => b.remainder - a.remainder);

    for (const { entry } of withRemainders) {
      if (remainingUnits <= 0) break;
      entry.units += 1;
      remainingUnits -= 1;
    }
  }

  const totalUnits = codeEntries.reduce((sum, e) => sum + e.units, 0);

  return {
    entries: codeEntries,
    totalMinutes,
    totalUnits,
  };
}

/**
 * Standard 8-minute rule for a single timed code.
 *   <8 min  = 0 units
 *   8-22    = 1 unit
 *   23-37   = 2 units
 *   38-52   = 3 units
 *   53-67   = 4 units
 *   ...pattern: each additional 15 min = +1 unit
 */
function singleCodeUnits(minutes: number): number {
  if (minutes < 8) return 0;
  // 8-22 = 1, 23-37 = 2, etc.
  // Formula: floor((minutes + 7) / 15) gives the correct mapping
  // Verify: 8+7=15 -> 1, 22+7=29 -> 1, 23+7=30 -> 2, 37+7=44 -> 2, 38+7=45 -> 3
  return Math.floor((minutes + 7) / 15);
}

/**
 * Checks whether a CPT code is a timed code.
 */
export function isTimedCode(cptCode: string): boolean {
  return cptCode in TIMED_CPT_CODES;
}

/**
 * Checks whether a CPT code is an untimed / service-based code.
 */
export function isUntimedCode(cptCode: string): boolean {
  return cptCode in UNTIMED_CPT_CODES;
}
