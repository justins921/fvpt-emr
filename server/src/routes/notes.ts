import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query, transaction } from '../db';
import { Permission, AuditAction, NoteType, NoteStatus } from '../types';
import { logAudit } from '../services/audit';

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
    res.json({ success: true, data: result.rows });
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
    res.json({ success: true, data: result.rows[0] });
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
        input.subjective || null, input.objective || null,
        input.assessment || null, input.plan || null,
        input.evalData ? JSON.stringify(input.evalData) : null,
        input.cptCodes || [], input.icd10Codes || [],
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
        input.subjective, input.objective, input.assessment, input.plan,
        input.evalData ? JSON.stringify(input.evalData) : null,
        input.cptCodes, input.icd10Codes, input.treatmentTimeMinutes,
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

export default router;
