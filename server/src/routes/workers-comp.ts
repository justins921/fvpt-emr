import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Schemas ──

const wcStatusEnum = z.enum(['open', 'closed', 'denied', 'suspended', 'settled']);

const wcCreateSchema = z.object({
  patientId: z.string().uuid(),
  employerName: z.string().min(1).max(200),
  employerPhone: z.string().max(20).optional().nullable(),
  employerAddress: z.string().max(500).optional().nullable(),
  injuryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  injuryDescription: z.string().min(1),
  claimNumber: z.string().max(100).optional().nullable(),
  adjusterName: z.string().max(200).optional().nullable(),
  adjusterPhone: z.string().max(20).optional().nullable(),
  adjusterEmail: z.string().email().max(200).optional().nullable(),
  attorneyName: z.string().max(200).optional().nullable(),
  attorneyPhone: z.string().max(20).optional().nullable(),
  attorneyEmail: z.string().email().max(200).optional().nullable(),
  wcbCaseNumber: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const wcUpdateSchema = wcCreateSchema.partial();

const wcStatusUpdateSchema = z.object({
  status: wcStatusEnum,
});

// ── GET / ── List workers' compensation cases
router.get('/', requirePermission(Permission.WORKERS_COMP_VIEW), async (req: Request, res: Response) => {
  try {
    const { patient_id, status, page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = ['wc.clinic_id = $1'];
    const params: unknown[] = [req.auth!.clinicId];
    let paramIndex = 2;

    if (patient_id) {
      conditions.push(`wc.patient_id = $${paramIndex++}`);
      params.push(patient_id);
    }

    if (status) {
      const parsed = wcStatusEnum.safeParse(status);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid status filter. Must be one of: open, closed, denied, suspended, settled',
        });
        return;
      }
      conditions.push(`wc.status = $${paramIndex++}`);
      params.push(status);
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM workers_comp_cases wc WHERE ${whereClause}`,
      params
    );

    const result = await query(
      `SELECT wc.*,
              p.first_name AS patient_first_name,
              p.last_name  AS patient_last_name,
              p.mrn
       FROM workers_comp_cases wc
       JOIN patients p ON wc.patient_id = p.id
       WHERE ${whereClause}
       ORDER BY wc.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
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

// ── GET /:id ── Get single workers' compensation case
router.get('/:id', requirePermission(Permission.WORKERS_COMP_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT wc.*,
              p.first_name AS patient_first_name,
              p.last_name  AS patient_last_name,
              p.mrn,
              p.date_of_birth AS patient_dob,
              p.phone AS patient_phone
       FROM workers_comp_cases wc
       JOIN patients p ON wc.patient_id = p.id
       WHERE wc.id = $1 AND wc.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Workers comp case not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST / ── Create workers' compensation case
router.post('/', requirePermission(Permission.WORKERS_COMP_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = wcCreateSchema.parse(req.body);

    // Verify patient belongs to this clinic
    const patientCheck = await query(
      `SELECT id FROM patients WHERE id = $1 AND clinic_id = $2`,
      [input.patientId, req.auth!.clinicId]
    );
    if (patientCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    const result = await query(
      `INSERT INTO workers_comp_cases (
        clinic_id, patient_id, employer_name, employer_phone, employer_address,
        injury_date, injury_description, claim_number,
        adjuster_name, adjuster_phone, adjuster_email,
        attorney_name, attorney_phone, attorney_email,
        wcb_case_number, notes, status, created_by
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11,
        $12, $13, $14,
        $15, $16, 'open', $17
      ) RETURNING id`,
      [
        req.auth!.clinicId,
        input.patientId,
        input.employerName,
        input.employerPhone || null,
        input.employerAddress || null,
        input.injuryDate,
        input.injuryDescription,
        input.claimNumber || null,
        input.adjusterName || null,
        input.adjusterPhone || null,
        input.adjusterEmail || null,
        input.attorneyName || null,
        input.attorneyPhone || null,
        input.attorneyEmail || null,
        input.wcbCaseNumber || null,
        input.notes || null,
        req.auth!.userId,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.WC_CASE_CREATE,
      resourceType: 'workers_comp_case',
      resourceId: result.rows[0].id,
      details: { patientId: input.patientId, employerName: input.employerName },
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

// ── PUT /:id ── Update workers' compensation case
router.put('/:id', requirePermission(Permission.WORKERS_COMP_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = wcUpdateSchema.parse(req.body);

    // Verify case exists and belongs to this clinic
    const existing = await query(
      `SELECT id FROM workers_comp_cases WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Workers comp case not found' });
      return;
    }

    const fieldMap: Record<string, string> = {
      patientId: 'patient_id',
      employerName: 'employer_name',
      employerPhone: 'employer_phone',
      employerAddress: 'employer_address',
      injuryDate: 'injury_date',
      injuryDescription: 'injury_description',
      claimNumber: 'claim_number',
      adjusterName: 'adjuster_name',
      adjusterPhone: 'adjuster_phone',
      adjusterEmail: 'adjuster_email',
      attorneyName: 'attorney_name',
      attorneyPhone: 'attorney_phone',
      attorneyEmail: 'attorney_email',
      wcbCaseNumber: 'wcb_case_number',
      notes: 'notes',
    };

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3; // $1 = id, $2 = clinic_id

    for (const [key, value] of Object.entries(input)) {
      if (fieldMap[key] !== undefined) {
        fields.push(`${fieldMap[key]} = $${idx++}`);
        values.push(value ?? null);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    fields.push(`updated_at = NOW()`);

    const result = await query(
      `UPDATE workers_comp_cases SET ${fields.join(', ')} WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Workers comp case not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.WC_CASE_EDIT,
      resourceType: 'workers_comp_case',
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

// ── PUT /:id/status ── Update workers' compensation case status
router.put('/:id/status', requirePermission(Permission.WORKERS_COMP_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = wcStatusUpdateSchema.parse(req.body);

    const result = await query(
      `UPDATE workers_comp_cases
       SET status = $3, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING id, status`,
      [req.params.id, req.auth!.clinicId, input.status]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Workers comp case not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.WC_CASE_EDIT,
      resourceType: 'workers_comp_case',
      resourceId: req.params.id,
      details: { newStatus: input.status },
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

export default router;
