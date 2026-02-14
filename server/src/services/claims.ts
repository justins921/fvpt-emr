import { Claim, ClaimLineItem, ClaimStatus } from '../types';
import { query } from '../db';

// ── Claim Scrubbing Rules ──
export interface ScrubResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export function scrubClaim(claim: Claim): ScrubResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!claim.billing_provider_npi || claim.billing_provider_npi.length !== 10) {
    errors.push('Invalid billing provider NPI (must be 10 digits)');
  }
  if (!claim.rendering_provider_npi || claim.rendering_provider_npi.length !== 10) {
    errors.push('Invalid rendering provider NPI (must be 10 digits)');
  }
  if (!claim.service_date) {
    errors.push('Service date is required');
  }
  if (!claim.diagnosis_codes || claim.diagnosis_codes.length === 0) {
    errors.push('At least one diagnosis code (ICD-10) is required');
  }

  // Line items validation
  const lineItems = claim.line_items as ClaimLineItem[];
  if (!lineItems || lineItems.length === 0) {
    errors.push('At least one line item (CPT code) is required');
  } else {
    for (const item of lineItems) {
      if (!item.cpt_code) {
        errors.push(`Line ${item.line_number}: CPT code is required`);
      }
      if (item.charge_cents <= 0) {
        errors.push(`Line ${item.line_number}: Charge amount must be positive`);
      }
      if (item.units <= 0) {
        errors.push(`Line ${item.line_number}: Units must be positive`);
      }
      if (!item.diagnosis_pointers || item.diagnosis_pointers.length === 0) {
        errors.push(`Line ${item.line_number}: At least one diagnosis pointer required`);
      }
      // Validate diagnosis pointers reference valid indices
      for (const ptr of item.diagnosis_pointers || []) {
        if (ptr < 1 || ptr > (claim.diagnosis_codes?.length || 0)) {
          errors.push(`Line ${item.line_number}: Diagnosis pointer ${ptr} references non-existent diagnosis`);
        }
      }
    }
  }

  // Total charges should match line items
  const calculatedTotal = lineItems?.reduce((sum, item) => sum + item.charge_cents * item.units, 0) || 0;
  if (calculatedTotal !== claim.total_charge_cents) {
    warnings.push(`Total charges (${claim.total_charge_cents}) do not match sum of line items (${calculatedTotal})`);
  }

  // Service date validation
  if (claim.service_date) {
    const serviceDate = new Date(claim.service_date);
    const now = new Date();
    if (serviceDate > now) {
      errors.push('Service date cannot be in the future');
    }
    // Check for timely filing (1 year)
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    if (serviceDate < oneYearAgo) {
      warnings.push('Service date is over 1 year ago - may exceed timely filing limit');
    }
  }

  // ICD-10 format validation
  for (const code of claim.diagnosis_codes || []) {
    if (!/^[A-Z]\d{2}(\.\d{1,4})?$/.test(code)) {
      errors.push(`Invalid ICD-10 code format: ${code}`);
    }
  }

  // CPT code format validation
  for (const item of lineItems || []) {
    if (!/^\d{5}$/.test(item.cpt_code)) {
      errors.push(`Line ${item.line_number}: Invalid CPT code format: ${item.cpt_code} (must be 5 digits)`);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

// ── 837P EDI Generation (simplified) ──
export async function generate837P(claimId: string, clinicId: string): Promise<string> {
  const claimResult = await query(
    `SELECT c.*, p.first_name as patient_first_name, p.last_name as patient_last_name,
            p.date_of_birth, p.gender, p.address_line1, p.city, p.state, p.zip,
            i.payer_name, i.payer_id, i.member_id, i.group_number,
            i.subscriber_name, i.subscriber_dob, i.subscriber_relationship,
            cl.name as clinic_name, cl.npi as clinic_npi, cl.tax_id as clinic_tax_id,
            cl.address_line1 as clinic_address, cl.city as clinic_city,
            cl.state as clinic_state, cl.zip as clinic_zip
     FROM claims c
     JOIN patients p ON c.patient_id = p.id
     LEFT JOIN insurance i ON c.insurance_id = i.id
     JOIN clinics cl ON c.clinic_id = cl.id
     WHERE c.id = $1 AND c.clinic_id = $2`,
    [claimId, clinicId]
  );

  if (claimResult.rows.length === 0) {
    throw new Error('Claim not found');
  }

  const c = claimResult.rows[0];
  const lineItems = c.line_items as ClaimLineItem[];
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T]/g, '').substring(0, 12);

  // Simplified 837P EDI format (production would use a proper X12 library)
  const segments: string[] = [
    `ISA*00*          *00*          *ZZ*${padRight(c.clinic_npi, 15)}*ZZ*${padRight(c.payer_id || 'UNKNOWN', 15)}*${dateStr.substring(0, 6)}*${dateStr.substring(6, 10)}*^*00501*${padRight(claimId.substring(0, 9), 9)}*0*P*:~`,
    `GS*HC*${c.clinic_npi}*${c.payer_id || 'UNKNOWN'}*${dateStr.substring(0, 8)}*${dateStr.substring(8, 12)}*1*X*005010X222A1~`,
    `ST*837*0001*005010X222A1~`,
    `BHT*0019*00*${claimId.substring(0, 30)}*${dateStr.substring(0, 8)}*${dateStr.substring(8, 12)}*CH~`,
    // Billing provider
    `NM1*85*2*${c.clinic_name}*****XX*${c.clinic_npi}~`,
    `N3*${c.clinic_address}~`,
    `N4*${c.clinic_city}*${c.clinic_state}*${c.clinic_zip}~`,
    `REF*EI*${c.clinic_tax_id}~`,
    // Subscriber/Patient
    `NM1*IL*1*${c.patient_last_name}*${c.patient_first_name}****MI*${c.member_id || 'UNKNOWN'}~`,
    `N3*${c.address_line1 || 'UNKNOWN'}~`,
    `N4*${c.city || 'UNKNOWN'}*${c.state || 'XX'}*${c.zip || '00000'}~`,
    `DMG*D8*${formatDateEDI(c.date_of_birth)}*${c.gender === 'male' ? 'M' : 'F'}~`,
    // Claim info
    `CLM*${c.claim_number || claimId.substring(0, 20)}*${(c.total_charge_cents / 100).toFixed(2)}***11:B:1*Y*A*Y*Y~`,
  ];

  // Diagnosis codes
  const diagCodes = (c.diagnosis_codes || []).slice(0, 12);
  if (diagCodes.length > 0) {
    const hiSegment = diagCodes.map((code: string, i: number) => 
      `${i === 0 ? 'ABK' : 'ABF'}:${code.replace('.', '')}`
    ).join('*');
    segments.push(`HI*${hiSegment}~`);
  }

  // Rendering provider
  segments.push(`NM1*82*1*${c.patient_last_name}*${c.patient_first_name}****XX*${c.rendering_provider_npi}~`);

  // Line items (SV1 segments)
  for (const item of lineItems) {
    const modStr = item.modifiers?.length ? `:${item.modifiers.join(':')}` : '';
    const diagPtrs = item.diagnosis_pointers?.join(':') || '1';
    segments.push(
      `LX*${item.line_number}~`,
      `SV1*HC:${item.cpt_code}${modStr}*${(item.charge_cents / 100).toFixed(2)}*UN*${item.units}*${diagPtrs}~`,
      `DTP*472*D8*${formatDateEDI(c.service_date)}~`
    );
  }

  segments.push(
    `SE*${segments.length - 2}*0001~`,
    `GE*1*1~`,
    `IEA*1*${padRight(claimId.substring(0, 9), 9)}~`
  );

  return segments.join('\n');
}

function padRight(str: string, len: number): string {
  return str.padEnd(len).substring(0, len);
}

function formatDateEDI(date: string | Date): string {
  const d = new Date(date);
  return d.toISOString().substring(0, 10).replace(/-/g, '');
}

// ── ERA (835) Parsing (simplified) ──
export interface ParsedERA {
  checkNumber: string;
  checkDate: string;
  payerName: string;
  totalPaid: number;
  claims: Array<{
    claimNumber: string;
    patientName: string;
    serviceDate: string;
    paidAmount: number;
    adjustments: Array<{ reasonCode: string; amount: number }>;
    lineItems: Array<{
      cptCode: string;
      chargeAmount: number;
      paidAmount: number;
      adjustmentAmount: number;
      denialReason: string | null;
    }>;
  }>;
}

export function parseERA(content: string): ParsedERA {
  // Simplified ERA parser - in production, use a proper X12 835 parser
  const lines = content.split(/[~\n]/).filter(l => l.trim());

  const era: ParsedERA = {
    checkNumber: '',
    checkDate: '',
    payerName: '',
    totalPaid: 0,
    claims: [],
  };

  let currentClaim: ParsedERA['claims'][0] | null = null;

  for (const line of lines) {
    const elements = line.split('*');
    const segmentId = elements[0]?.trim();

    switch (segmentId) {
      case 'BPR':
        era.totalPaid = parseFloat(elements[2] || '0') * 100;
        break;
      case 'TRN':
        era.checkNumber = elements[2] || '';
        break;
      case 'DTM':
        if (elements[1] === '405') {
          era.checkDate = elements[2] || '';
        }
        break;
      case 'N1':
        if (elements[1] === 'PR') {
          era.payerName = elements[2] || '';
        }
        break;
      case 'CLP':
        if (currentClaim) {
          era.claims.push(currentClaim);
        }
        currentClaim = {
          claimNumber: elements[1] || '',
          patientName: '',
          serviceDate: '',
          paidAmount: parseFloat(elements[4] || '0') * 100,
          adjustments: [],
          lineItems: [],
        };
        break;
      case 'NM1':
        if (elements[1] === 'QC' && currentClaim) {
          currentClaim.patientName = `${elements[3] || ''} ${elements[4] || ''}`.trim();
        }
        break;
      case 'SVC':
        if (currentClaim) {
          const cptParts = (elements[1] || '').split(':');
          currentClaim.lineItems.push({
            cptCode: cptParts[1] || cptParts[0] || '',
            chargeAmount: parseFloat(elements[2] || '0') * 100,
            paidAmount: parseFloat(elements[3] || '0') * 100,
            adjustmentAmount: 0,
            denialReason: null,
          });
        }
        break;
      case 'CAS':
        if (currentClaim && currentClaim.lineItems.length > 0) {
          const lastItem = currentClaim.lineItems[currentClaim.lineItems.length - 1];
          const reasonCode = elements[2] || '';
          const amount = parseFloat(elements[3] || '0') * 100;
          lastItem.adjustmentAmount += amount;
          if (elements[1] === 'CO' || elements[1] === 'OA') {
            currentClaim.adjustments.push({ reasonCode, amount });
          }
          if (elements[1] === 'PR') {
            // Patient responsibility
          }
        }
        break;
    }
  }

  if (currentClaim) {
    era.claims.push(currentClaim);
  }

  return era;
}

// ── ERA Auto-Post to Ledger ──
export async function postERAToLedger(
  eraId: string,
  clinicId: string,
  postedBy: string
): Promise<{ posted: number; errors: string[] }> {
  const eraResult = await query(
    'SELECT * FROM era_files WHERE id = $1 AND clinic_id = $2',
    [eraId, clinicId]
  );

  if (eraResult.rows.length === 0) {
    throw new Error('ERA file not found');
  }

  const era = eraResult.rows[0];
  if (era.posted) {
    throw new Error('ERA already posted');
  }

  const parsed = parseERA(era.raw_content);
  let posted = 0;
  const errors: string[] = [];

  for (const eraClaim of parsed.claims) {
    // Try to match claim by claim number
    const claimResult = await query(
      `SELECT id, patient_id FROM claims WHERE clinic_id = $1 AND (claim_number = $2 OR id::text LIKE $3)`,
      [clinicId, eraClaim.claimNumber, `${eraClaim.claimNumber}%`]
    );

    if (claimResult.rows.length === 0) {
      errors.push(`Could not match ERA claim: ${eraClaim.claimNumber}`);
      continue;
    }

    const claim = claimResult.rows[0];

    // Post payment to ledger
    if (eraClaim.paidAmount > 0) {
      await query(
        `INSERT INTO ledger_entries (clinic_id, patient_id, claim_id, entry_type, amount_cents, description, payer_name, check_number, posted_by)
         VALUES ($1, $2, $3, 'payment', $4, $5, $6, $7, $8)`,
        [
          clinicId, claim.patient_id, claim.id,
          Math.round(eraClaim.paidAmount),
          `ERA payment - Check ${parsed.checkNumber}`,
          parsed.payerName,
          parsed.checkNumber,
          postedBy,
        ]
      );
    }

    // Post adjustments
    for (const adj of eraClaim.adjustments) {
      await query(
        `INSERT INTO ledger_entries (clinic_id, patient_id, claim_id, entry_type, amount_cents, description, payer_name, posted_by)
         VALUES ($1, $2, $3, 'adjustment', $4, $5, $6, $7)`,
        [
          clinicId, claim.patient_id, claim.id,
          Math.round(adj.amount),
          `ERA adjustment - Reason: ${adj.reasonCode}`,
          parsed.payerName,
          postedBy,
        ]
      );
    }

    // Update claim status
    const totalPaid = Math.round(eraClaim.paidAmount);
    await query(
      `UPDATE claims SET 
        status = CASE WHEN $3 >= total_charge_cents THEN 'paid' ELSE 'partially_paid' END,
        total_paid_cents = total_paid_cents + $3,
        era_id = $4
       WHERE id = $1 AND clinic_id = $2`,
      [claim.id, clinicId, totalPaid, eraId]
    );

    posted++;
  }

  // Mark ERA as posted
  await query(
    `UPDATE era_files SET posted = true, posted_by = $2, posted_at = NOW() WHERE id = $1`,
    [eraId, postedBy]
  );

  return { posted, errors };
}
