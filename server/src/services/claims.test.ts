import { describe, it, expect } from 'vitest';
import { scrubClaim, parseERA } from './claims';
import { Claim, ClaimStatus, ClaimLineItem } from '../types';

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'test-claim-id',
    clinic_id: 'test-clinic-id',
    patient_id: 'test-patient-id',
    appointment_id: null,
    note_id: null,
    insurance_id: null,
    status: ClaimStatus.DRAFT,
    claim_number: 'CLM-TEST-001',
    payer_claim_number: null,
    service_date: '2024-06-15',
    billing_provider_npi: '1234567890',
    rendering_provider_npi: '0987654321',
    diagnosis_codes: ['M54.5'],
    line_items: [{
      line_number: 1,
      cpt_code: '97110',
      modifiers: [],
      diagnosis_pointers: [1],
      units: 2,
      charge_cents: 7500,
      paid_cents: 0,
      adjustment_cents: 0,
      denial_reason: null,
    }] as ClaimLineItem[],
    total_charge_cents: 15000,
    total_paid_cents: 0,
    total_adjustment_cents: 0,
    patient_responsibility_cents: 0,
    scrub_errors: [],
    submitted_at: null,
    era_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('Claim Scrubbing', () => {
  it('should pass a valid claim', () => {
    const result = scrubClaim(makeClaim());
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail if billing NPI is missing', () => {
    const result = scrubClaim(makeClaim({ billing_provider_npi: '' }));
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('billing provider NPI'))).toBe(true);
  });

  it('should fail if rendering NPI is wrong length', () => {
    const result = scrubClaim(makeClaim({ rendering_provider_npi: '123' }));
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('rendering provider NPI'))).toBe(true);
  });

  it('should fail if no diagnosis codes', () => {
    const result = scrubClaim(makeClaim({ diagnosis_codes: [] }));
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('diagnosis code'))).toBe(true);
  });

  it('should fail if no line items', () => {
    const result = scrubClaim(makeClaim({ line_items: [] }));
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('line item'))).toBe(true);
  });

  it('should fail if CPT code format is invalid', () => {
    const claim = makeClaim();
    (claim.line_items as ClaimLineItem[])[0].cpt_code = 'ABC';
    const result = scrubClaim(claim);
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('CPT code format'))).toBe(true);
  });

  it('should fail if ICD-10 code format is invalid', () => {
    const result = scrubClaim(makeClaim({ diagnosis_codes: ['INVALID'] }));
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('ICD-10 code format'))).toBe(true);
  });

  it('should fail if diagnosis pointer references non-existent code', () => {
    const claim = makeClaim();
    (claim.line_items as ClaimLineItem[])[0].diagnosis_pointers = [5];
    const result = scrubClaim(claim);
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('Diagnosis pointer'))).toBe(true);
  });

  it('should fail if service date is in the future', () => {
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString().substring(0, 10);
    const result = scrubClaim(makeClaim({ service_date: futureDate }));
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('future'))).toBe(true);
  });

  it('should warn if charges total mismatch', () => {
    const result = scrubClaim(makeClaim({ total_charge_cents: 99999 }));
    expect(result.warnings.some(w => w.includes('do not match'))).toBe(true);
  });
});

describe('ERA Parsing', () => {
  const sampleERA = [
    'BPR*I*150.00*C*ACH',
    'TRN*1*CHK123456',
    'DTM*405*20240115',
    'N1*PR*DEMO INSURANCE CO',
    'CLP*CLM-001*1*200.00*150.00',
    'NM1*QC*1*DOE*JANE',
    'SVC*HC:97110*75.00*60.00',
    'CAS*CO*45*15.00',
    'SVC*HC:97140*65.00*50.00',
    'CAS*CO*45*15.00',
  ].join('~\n');

  it('should parse check number', () => {
    const result = parseERA(sampleERA);
    expect(result.checkNumber).toBe('CHK123456');
  });

  it('should parse payer name', () => {
    const result = parseERA(sampleERA);
    expect(result.payerName).toBe('DEMO INSURANCE CO');
  });

  it('should parse total paid', () => {
    const result = parseERA(sampleERA);
    expect(result.totalPaid).toBe(15000);
  });

  it('should parse claims', () => {
    const result = parseERA(sampleERA);
    expect(result.claims.length).toBe(1);
    expect(result.claims[0].claimNumber).toBe('CLM-001');
  });

  it('should parse line items', () => {
    const result = parseERA(sampleERA);
    expect(result.claims[0].lineItems.length).toBe(2);
    expect(result.claims[0].lineItems[0].cptCode).toBe('97110');
  });

  it('should parse adjustments', () => {
    const result = parseERA(sampleERA);
    expect(result.claims[0].adjustments.length).toBeGreaterThan(0);
    expect(result.claims[0].adjustments[0].reasonCode).toBe('45');
  });
});
