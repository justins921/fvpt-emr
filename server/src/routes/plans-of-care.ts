import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Zod Schemas ──

const treatmentGoalSchema = z.object({
  goal: z.string().min(1),
  type: z.enum(['short_term', 'long_term']),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(['not_started', 'in_progress', 'met', 'not_met']),
});

const pocCreateSchema = z.object({
  patient_id: z.string().uuid(),
  therapist_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  frequency: z.string().min(1).max(100),
  duration_weeks: z.number().int().min(1).max(52),
  diagnosis_codes: z.array(z.string().max(10)),
  treatment_goals: z.array(treatmentGoalSchema),
  physician_name: z.string().min(1).max(200),
  physician_npi: z.string().max(10).optional().nullable(),
  physician_phone: z.string().max(20).optional().nullable(),
  physician_fax: z.string().max(20).optional().nullable(),
  certification_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  recertification_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const pocUpdateSchema = pocCreateSchema.partial();

const signatureStatusSchema = z.object({
  physician_signature_status: z.enum(['pending', 'sent', 'received', 'expired']),
  signed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

// ── GET /alerts/expiring ──
// Must be defined BEFORE /:id so it does not get caught by the param route
router.get('/alerts/expiring', requirePermission(Permission.POC_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT poc.*,
              p.first_name AS patient_first_name,
              p.last_name  AS patient_last_name,
              p.mrn,
              u.first_name AS therapist_first_name,
              u.last_name  AS therapist_last_name
       FROM plans_of_care poc
       JOIN patients p ON poc.patient_id = p.id
       JOIN users u    ON poc.therapist_id = u.id
       WHERE poc.clinic_id = $1
         AND poc.status = 'active'
         AND (
           (poc.recertification_due_date IS NOT NULL AND poc.recertification_due_date <= CURRENT_DATE + INTERVAL '14 days')
           OR poc.physician_signature_status = 'pending'
         )
       ORDER BY poc.recertification_due_date ASC NULLS LAST`,
      [req.auth!.clinicId]
    );

    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET / ── List Plans of Care
router.get('/', requirePermission(Permission.POC_VIEW), async (req: Request, res: Response) => {
  try {
    const { patient_id, status, page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'poc.clinic_id = $1';
    const params: unknown[] = [req.auth!.clinicId];

    if (patient_id) {
      whereClause += ` AND poc.patient_id = $${params.length + 1}`;
      params.push(patient_id);
    }

    if (status) {
      const validStatuses = ['active', 'expired', 'completed', 'cancelled'];
      if (!validStatuses.includes(status as string)) {
        res.status(400).json({ success: false, error: 'Invalid status. Must be one of: active, expired, completed, cancelled' });
        return;
      }
      whereClause += ` AND poc.status = $${params.length + 1}`;
      params.push(status);
    }

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM plans_of_care poc WHERE ${whereClause}`,
      params
    );

    const result = await query(
      `SELECT poc.*,
              p.first_name AS patient_first_name,
              p.last_name  AS patient_last_name,
              p.mrn,
              u.first_name AS therapist_first_name,
              u.last_name  AS therapist_last_name
       FROM plans_of_care poc
       JOIN patients p ON poc.patient_id = p.id
       JOIN users u    ON poc.therapist_id = u.id
       WHERE ${whereClause}
       ORDER BY poc.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limitNum, offset]
    );

    res.json({
      success: true,
      data: result.rows,
      meta: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(countResult.rows[0].total, 10),
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /:id ── Get single Plan of Care
router.get('/:id', requirePermission(Permission.POC_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT poc.*,
              p.first_name AS patient_first_name,
              p.last_name  AS patient_last_name,
              p.mrn,
              u.first_name AS therapist_first_name,
              u.last_name  AS therapist_last_name
       FROM plans_of_care poc
       JOIN patients p ON poc.patient_id = p.id
       JOIN users u    ON poc.therapist_id = u.id
       WHERE poc.id = $1 AND poc.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Plan of care not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST / ── Create Plan of Care
router.post('/', requirePermission(Permission.POC_CREATE), async (req: Request, res: Response) => {
  try {
    const input = pocCreateSchema.parse(req.body);

    // Verify patient belongs to this clinic
    const patientCheck = await query(
      `SELECT id FROM patients WHERE id = $1 AND clinic_id = $2`,
      [input.patient_id, req.auth!.clinicId]
    );
    if (patientCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    // Verify therapist belongs to this clinic
    const therapistCheck = await query(
      `SELECT id FROM users WHERE id = $1 AND clinic_id = $2 AND is_active = true`,
      [input.therapist_id, req.auth!.clinicId]
    );
    if (therapistCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Therapist not found' });
      return;
    }

    const result = await query(
      `INSERT INTO plans_of_care (
        clinic_id, patient_id, therapist_id, start_date, end_date,
        frequency, duration_weeks, diagnosis_codes, treatment_goals,
        physician_name, physician_npi, physician_phone, physician_fax,
        certification_date, recertification_due_date, notes,
        status, physician_signature_status, created_by
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16,
        'active', 'pending', $17
      ) RETURNING id`,
      [
        req.auth!.clinicId,
        input.patient_id,
        input.therapist_id,
        input.start_date,
        input.end_date,
        input.frequency,
        input.duration_weeks,
        input.diagnosis_codes,
        JSON.stringify(input.treatment_goals),
        input.physician_name,
        input.physician_npi || null,
        input.physician_phone || null,
        input.physician_fax || null,
        input.certification_date || null,
        input.recertification_due_date || null,
        input.notes || null,
        req.auth!.userId,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.POC_CREATE,
      resourceType: 'plan_of_care',
      resourceId: result.rows[0].id,
      details: { patientId: input.patient_id },
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

// ── PUT /:id ── Update Plan of Care
router.put('/:id', requirePermission(Permission.POC_EDIT), async (req: Request, res: Response) => {
  try {
    const input = pocUpdateSchema.parse(req.body);

    // Verify POC exists and belongs to this clinic
    const existing = await query(
      `SELECT id, status FROM plans_of_care WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Plan of care not found' });
      return;
    }

    const fieldMap: Record<string, string> = {
      patient_id: 'patient_id',
      therapist_id: 'therapist_id',
      start_date: 'start_date',
      end_date: 'end_date',
      frequency: 'frequency',
      duration_weeks: 'duration_weeks',
      diagnosis_codes: 'diagnosis_codes',
      treatment_goals: 'treatment_goals',
      physician_name: 'physician_name',
      physician_npi: 'physician_npi',
      physician_phone: 'physician_phone',
      physician_fax: 'physician_fax',
      certification_date: 'certification_date',
      recertification_due_date: 'recertification_due_date',
      notes: 'notes',
    };

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3; // $1 = id, $2 = clinic_id

    for (const [key, value] of Object.entries(input)) {
      if (fieldMap[key]) {
        fields.push(`${fieldMap[key]} = $${idx++}`);
        if (key === 'treatment_goals') {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    fields.push(`updated_at = NOW()`);

    const result = await query(
      `UPDATE plans_of_care SET ${fields.join(', ')} WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Plan of care not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.POC_EDIT,
      resourceType: 'plan_of_care',
      resourceId: req.params.id,
      details: { updatedFields: Object.keys(input) },
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

// ── PUT /:id/signature ── Update physician signature status
router.put('/:id/signature', requirePermission(Permission.POC_EDIT), async (req: Request, res: Response) => {
  try {
    const input = signatureStatusSchema.parse(req.body);

    const existing = await query(
      `SELECT id FROM plans_of_care WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Plan of care not found' });
      return;
    }

    const result = await query(
      `UPDATE plans_of_care
       SET physician_signature_status = $3,
           signed_date = $4,
           updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING id, physician_signature_status, signed_date`,
      [
        req.params.id,
        req.auth!.clinicId,
        input.physician_signature_status,
        input.signed_date || null,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.POC_SIGN,
      resourceType: 'plan_of_care',
      resourceId: req.params.id,
      details: { signatureStatus: input.physician_signature_status },
      req,
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /:id/recertify ── Create new POC from existing one
router.post('/:id/recertify', requirePermission(Permission.POC_CREATE), async (req: Request, res: Response) => {
  try {
    // Fetch the existing POC
    const existing = await query(
      `SELECT * FROM plans_of_care WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Plan of care not found' });
      return;
    }

    const orig = existing.rows[0];

    // Optional overrides from request body
    const overrides = z.object({
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      duration_weeks: z.number().int().min(1).max(52).optional(),
      certification_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      recertification_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(req.body || {});

    // Mark old POC as completed
    await query(
      `UPDATE plans_of_care SET status = 'completed', updated_at = NOW() WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    // Reset goal statuses for the new POC: keep goals but mark met ones as met, reset others to not_started
    let treatmentGoals = orig.treatment_goals;
    if (Array.isArray(treatmentGoals)) {
      treatmentGoals = treatmentGoals.map((g: { goal: string; type: string; target_date: string | null; status: string }) => ({
        ...g,
        status: g.status === 'met' ? 'met' : 'not_started',
      }));
    }

    const result = await query(
      `INSERT INTO plans_of_care (
        clinic_id, patient_id, therapist_id, start_date, end_date,
        frequency, duration_weeks, diagnosis_codes, treatment_goals,
        physician_name, physician_npi, physician_phone, physician_fax,
        certification_date, recertification_due_date, notes,
        status, physician_signature_status, parent_poc_id, created_by
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16,
        'active', 'pending', $17, $18
      ) RETURNING id`,
      [
        req.auth!.clinicId,
        orig.patient_id,
        orig.therapist_id,
        overrides.start_date || orig.end_date, // new POC starts where old one ended
        overrides.end_date || null,
        orig.frequency,
        overrides.duration_weeks || orig.duration_weeks,
        orig.diagnosis_codes,
        JSON.stringify(treatmentGoals),
        orig.physician_name,
        orig.physician_npi,
        orig.physician_phone,
        orig.physician_fax,
        overrides.certification_date !== undefined ? overrides.certification_date : null,
        overrides.recertification_due_date !== undefined ? overrides.recertification_due_date : null,
        overrides.notes !== undefined ? overrides.notes : orig.notes,
        req.params.id, // parent_poc_id
        req.auth!.userId,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.POC_CREATE,
      resourceType: 'plan_of_care',
      resourceId: result.rows[0].id,
      details: { recertifiedFrom: req.params.id, patientId: orig.patient_id },
      req,
    });

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        parentPocId: req.params.id,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
