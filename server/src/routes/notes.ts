import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query, transaction } from '../db';
import { Permission, AuditAction, NoteType, NoteStatus, ClaimStatus, Claim, TimedCPTEntry } from '../types';
import { logAudit } from '../services/audit';
import { calculateUnits, isTimedCode } from '../services/eight-minute-rule';
import { scrubClaim } from '../services/claims';
import { encryptValue, decryptNoteRecord, decryptNoteRecords } from '../services/phi';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

const noteSchema = z.object({
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().optional().nullable(),
  noteType: z.nativeEnum(NoteType),
  subjective: z.string().optional().nullable(),
  objective: z.string().optional().nullable(),
  assessment: z.string().optional().nullable(),
  plan: z.string().optional().nullable(),
  evalData: z.record(z.unknown()).optional().nullable(),
  cptCodes: z.array(z.string()).optional(),
  icd10Codes: z.array(z.string()).optional(),
  treatmentTimeMinutes: z.number().int().min(0).optional().nullable(),
});

// Get latest note for a patient (copy-forward source picker)
router.get('/patient/:patientId/latest', requirePermission(Permission.NOTE_VIEW), async (req: Request, res: Response) => {
  try {
    const noteType = typeof req.query.noteType === 'string' ? req.query.noteType : undefined;

    let sql = `
      SELECT cn.*, u.first_name as author_first_name, u.last_name as author_last_name
      FROM clinical_notes cn
      JOIN users u ON cn.author_id = u.id
      WHERE cn.clinic_id = $1 AND cn.patient_id = $2`;
    const params: unknown[] = [req.auth!.clinicId, req.params.patientId];

    if (noteType) {
      sql += ` AND cn.note_type = $${params.length + 1}`;
      params.push(noteType);
    }
    sql += ` ORDER BY cn.created_at DESC LIMIT 1`;

    const result = await query(sql, params);
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'No prior notes found' });
      return;
    }
    res.json({ success: true, data: decryptNoteRecord(result.rows[0]) });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// List notes for a patient
router.get('/patient/:patientId', requirePermission(Permission.NOTE_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT cn.*, u.first_name as author_first_name, u.last_name as author_last_name
       FROM clinical_notes cn
       JOIN users u ON cn.author_id = u.id
       WHERE cn.clinic_id = $1 AND cn.patient_id = $2
       ORDER BY cn.created_at DESC`,
      [req.auth!.clinicId, req.params.patientId]
    );
    res.json({ success: true, data: decryptNoteRecords(result.rows) });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get single note
router.get('/:id', requirePermission(Permission.NOTE_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT cn.*, u.first_name as author_first_name, u.last_name as author_last_name,
              s.first_name as signer_first_name, s.last_name as signer_last_name
       FROM clinical_notes cn
       JOIN users u ON cn.author_id = u.id
       LEFT JOIN users s ON cn.signed_by = s.id
       WHERE cn.id = $1 AND cn.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.NOTE_VIEW,
      resourceType: 'clinical_note',
      resourceId: req.params.id,
      req,
    });
    res.json({ success: true, data: decryptNoteRecord(result.rows[0]) });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Create note (draft)
router.post('/', requirePermission(Permission.NOTE_CREATE), async (req: Request, res: Response) => {
  try {
    const input = noteSchema.parse(req.body);
    const result = await query(
      `INSERT INTO clinical_notes (
        clinic_id, patient_id, appointment_id, author_id, note_type,
        subjective, objective, assessment, plan, eval_data,
        cpt_codes, icd10_codes, treatment_time_minutes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id`,
      [
        req.auth!.clinicId, input.patientId, input.appointmentId || null,
        req.auth!.userId, input.noteType,
        encryptValue(input.subjective) || null, encryptValue(input.objective) || null,
        encryptValue(input.assessment) || null, encryptValue(input.plan) || null,
        input.evalData ? encryptValue(JSON.stringify(input.evalData)) : null,
        input.cptCodes || [], (input.icd10Codes || []).map(c => encryptValue(c)),
        input.treatmentTimeMinutes || null,
      ]
    );
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.NOTE_CREATE,
      resourceType: 'clinical_note',
      resourceId: result.rows[0].id,
      details: { noteType: input.noteType },
      req,
    });
    res.status(201).json({ success: true, data: { id: result.rows[0].id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Update note (draft only)
router.put('/:id', requirePermission(Permission.NOTE_EDIT), async (req: Request, res: Response) => {
  try {
    // Check note is still in draft
    const existing = await query(
      `SELECT status, author_id FROM clinical_notes WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    if (existing.rows[0].status !== NoteStatus.DRAFT) {
      res.status(400).json({ success: false, error: 'Only draft notes can be edited. Use amend for finalized notes.' });
      return;
    }

    const input = noteSchema.partial().parse(req.body);
    const result = await query(
      `UPDATE clinical_notes SET
        subjective = COALESCE($3, subjective),
        objective = COALESCE($4, objective),
        assessment = COALESCE($5, assessment),
        plan = COALESCE($6, plan),
        eval_data = COALESCE($7, eval_data),
        cpt_codes = COALESCE($8, cpt_codes),
        icd10_codes = COALESCE($9, icd10_codes),
        treatment_time_minutes = COALESCE($10, treatment_time_minutes)
       WHERE id = $1 AND clinic_id = $2
       RETURNING id`,
      [
        req.params.id, req.auth!.clinicId,
        encryptValue(input.subjective), encryptValue(input.objective),
        encryptValue(input.assessment), encryptValue(input.plan),
        input.evalData ? encryptValue(JSON.stringify(input.evalData)) : null,
        input.cptCodes, input.icd10Codes ? input.icd10Codes.map(c => encryptValue(c)) : null,
        input.treatmentTimeMinutes,
      ]
    );
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.NOTE_EDIT,
      resourceType: 'clinical_note',
      resourceId: req.params.id,
      req,
    });
    res.json({ success: true, data: { id: req.params.id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Sign/finalize note
router.post('/:id/sign', requirePermission(Permission.NOTE_SIGN), async (req: Request, res: Response) => {
  try {
    const existing = await query(
      `SELECT status FROM clinical_notes WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    if (existing.rows[0].status !== NoteStatus.DRAFT) {
      res.status(400).json({ success: false, error: 'Note is already finalized' });
      return;
    }

    await query(
      `UPDATE clinical_notes SET status = 'final', signed_by = $3, signed_at = NOW()
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId, req.auth!.userId]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.NOTE_SIGN,
      resourceType: 'clinical_note',
      resourceId: req.params.id,
      req,
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Amend note (creates new version)
router.post('/:id/amend', requirePermission(Permission.NOTE_AMEND), async (req: Request, res: Response) => {
  try {
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);

    const existing = await query(
      `SELECT * FROM clinical_notes WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    if (existing.rows[0].status === NoteStatus.DRAFT) {
      res.status(400).json({ success: false, error: 'Cannot amend a draft note. Edit it directly.' });
      return;
    }

    const orig = existing.rows[0];

    // Mark original as amended
    await query(
      `UPDATE clinical_notes SET status = 'amended' WHERE id = $1`,
      [req.params.id]
    );

    // Create new version
    const result = await query(
      `INSERT INTO clinical_notes (
        clinic_id, patient_id, appointment_id, author_id, note_type,
        status, version, parent_note_id, amendment_reason,
        subjective, objective, assessment, plan, eval_data,
        cpt_codes, icd10_codes, treatment_time_minutes
      ) VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id`,
      [
        orig.clinic_id, orig.patient_id, orig.appointment_id, req.auth!.userId,
        orig.note_type, orig.version + 1, req.params.id, reason,
        orig.subjective, orig.objective, orig.assessment, orig.plan,
        orig.eval_data, orig.cpt_codes, orig.icd10_codes, orig.treatment_time_minutes,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.NOTE_AMEND,
      resourceType: 'clinical_note',
      resourceId: req.params.id,
      details: { newNoteId: result.rows[0].id, version: orig.version + 1 },
      req,
    });

    res.status(201).json({ success: true, data: { id: result.rows[0].id, parentId: req.params.id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Generate Claim From Signed Note ──
// Builds a draft claim from a signed note's CPT/ICD-10 codes, applying the
// 8-minute rule to timed codes. Charges default to $0 (no fee schedule yet).
router.post('/:id/generate-claim', requirePermission(Permission.BILLING_CREATE), async (req: Request, res: Response) => {
  try {
    const noteResult = await query(
      `SELECT cn.*,
              cl.npi AS clinic_npi,
              u.npi AS author_npi,
              (SELECT i.id FROM insurance i
                WHERE i.patient_id = cn.patient_id AND i.clinic_id = cn.clinic_id
                  AND i.is_primary = true AND i.is_active = true
                ORDER BY i.created_at DESC LIMIT 1) AS primary_insurance_id
       FROM clinical_notes cn
       JOIN clinics cl ON cl.id = cn.clinic_id
       JOIN users u ON u.id = cn.author_id
       WHERE cn.id = $1 AND cn.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (noteResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }

    const note = noteResult.rows[0];

    if (note.status !== NoteStatus.FINAL) {
      res.status(400).json({ success: false, error: 'Note must be signed before generating a claim' });
      return;
    }

    const cptCodes: string[] = (note.cpt_codes as string[] | null) || [];
    if (cptCodes.length === 0) {
      res.status(400).json({ success: false, error: 'Note has no CPT codes to generate a claim from' });
      return;
    }

    const diagnosisCodes: string[] = (note.icd10_codes as string[] | null) || [];
    if (diagnosisCodes.length === 0) {
      res.status(400).json({ success: false, error: 'Note has no diagnosis codes to generate a claim from' });
      return;
    }

    // Split timed vs untimed codes
    const timedCodes = cptCodes.filter(isTimedCode);
    const untimedCodes = cptCodes.filter((code: string) => !isTimedCode(code));

    // Evenly allocate treatment minutes across timed codes
    const totalMinutes = note.treatment_time_minutes || 0;
    const perCodeMinutes = timedCodes.length > 0 ? Math.round(totalMinutes / timedCodes.length) : 0;
    const timedEntries: TimedCPTEntry[] = timedCodes.map((cptCode: string) => ({
      cptCode,
      minutes: perCodeMinutes,
    }));

    const calculatedUnits = calculateUnits(timedEntries);
    const unitsByCode = new Map<string, number>();
    for (const entry of calculatedUnits.entries) {
      unitsByCode.set(entry.cptCode, entry.units);
    }

    // Line items: timed codes use 8-minute-rule units, untimed codes are per-encounter (1 unit)
    let lineNumber = 1;
    const lineItems = cptCodes.map((cptCode: string) => {
      const units = unitsByCode.has(cptCode) ? unitsByCode.get(cptCode)! : 1;
      return {
        lineNumber: lineNumber++,
        cptCode,
        modifiers: [] as string[],
        diagnosisPointers: diagnosisCodes.map((_: string, i: number) => i + 1),
        units,
        chargeCents: 0,
      };
    });

    const totalChargeCents = 0;
    const claimNumber = `CLM-${Date.now().toString(36).toUpperCase()}`;

    const billingProviderNpi =
      note.clinic_npi && String(note.clinic_npi).length === 10 ? note.clinic_npi : '0000000000';
    const renderingProviderNpi =
      note.author_npi && String(note.author_npi).length === 10 ? note.author_npi : '0000000000';

    const lineItemsForDb = lineItems.map((item) => ({
      line_number: item.lineNumber,
      cpt_code: item.cptCode,
      modifiers: item.modifiers,
      diagnosis_pointers: item.diagnosisPointers,
      units: item.units,
      charge_cents: item.chargeCents,
      paid_cents: 0,
      adjustment_cents: 0,
      denial_reason: null,
    }));

    // Service date: note's signed date, falling back to creation date
    const signedAt = note.signed_at ? new Date(note.signed_at) : null;
    const createdAt = new Date(note.created_at);
    const serviceDate = (signedAt || createdAt).toISOString().slice(0, 10);

    const claimResult = await query(
      `INSERT INTO claims (clinic_id, patient_id, appointment_id, note_id, insurance_id, service_date,
        billing_provider_npi, rendering_provider_npi, diagnosis_codes, line_items,
        total_charge_cents, claim_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        req.auth!.clinicId,
        note.patient_id,
        note.appointment_id || null,
        note.id,
        note.primary_insurance_id || null,
        serviceDate,
        billingProviderNpi,
        renderingProviderNpi,
        diagnosisCodes,
        JSON.stringify(lineItemsForDb),
        totalChargeCents,
        claimNumber,
      ]
    );

    const claimId = claimResult.rows[0].id;

    // Skip ledger posting — total is $0 and posting zero-charge entries is noise

    // Scrub the claim and store the outcome
    const claimRow = await query(
      `SELECT * FROM claims WHERE id = $1 AND clinic_id = $2`,
      [claimId, req.auth!.clinicId]
    );
    const scrub = scrubClaim(claimRow.rows[0] as Claim);
    scrub.warnings.push('Charges defaulted to 0 — set fee schedule amounts before submitting');

    const newStatus = scrub.passed ? ClaimStatus.SCRUBBED : ClaimStatus.SCRUB_FAILED;
    await query(
      `UPDATE claims SET status = $3, scrub_errors = $4 WHERE id = $1 AND clinic_id = $2`,
      [claimId, req.auth!.clinicId, newStatus, scrub.errors]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.CLAIM_CREATE,
      resourceType: 'claim',
      resourceId: claimId,
      details: { claimNumber, noteId: note.id, totalChargeCents },
      req,
    });

    res.status(201).json({
      success: true,
      data: {
        claimId,
        claimNumber,
        units: calculatedUnits.totalUnits,
        totalMinutes: calculatedUnits.totalMinutes,
        scrub: {
          passed: scrub.passed,
          errors: scrub.errors,
          warnings: scrub.warnings,
        },
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
