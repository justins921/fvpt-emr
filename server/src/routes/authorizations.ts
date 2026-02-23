import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── List Authorizations ──
router.get('/', requirePermission(Permission.AUTHORIZATION_VIEW), async (req: Request, res: Response) => {
  try {
    const { patient_id, status, expiring_within_days, page = '1', limit = '25' } = req.query;
    const conditions: string[] = ['a.clinic_id = $1'];
    const params: unknown[] = [req.auth!.clinicId];
    let idx = 2;

    if (patient_id) {
      conditions.push(`a.patient_id = $${idx++}`);
      params.push(patient_id);
    }

    if (status) {
      conditions.push(`a.status = $${idx++}`);
      params.push(status);
    }

    if (expiring_within_days) {
      const days = parseInt(expiring_within_days as string, 10);
      if (!isNaN(days) && days > 0) {
        conditions.push(`a.end_date <= (CURRENT_DATE + $${idx++}::integer * INTERVAL '1 day')`);
        params.push(days);
        conditions.push(`a.end_date >= CURRENT_DATE`);
        conditions.push(`a.status = 'active'`);
      }
    }

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, parseInt(limit as string, 10));

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) as total FROM authorizations a WHERE ${where}`,
      params
    );

    const result = await query(
      `SELECT
         a.*,
         p.first_name as patient_first_name,
         p.last_name as patient_last_name,
         p.mrn as patient_mrn,
         i.payer_name,
         i.member_id as insurance_member_id,
         i.plan_name as insurance_plan_name
       FROM authorizations a
       JOIN patients p ON a.patient_id = p.id AND p.clinic_id = a.clinic_id
       LEFT JOIN insurance i ON a.insurance_id = i.id AND i.clinic_id = a.clinic_id
       WHERE ${where}
       ORDER BY a.end_date ASC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limitNum, (pageNum - 1) * limitNum]
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

// ── Get Alerts (Expiring Soon / Low Visits) ──
router.get('/alerts', requirePermission(Permission.AUTHORIZATION_VIEW), async (req: Request, res: Response) => {
  try {
    // Authorizations expiring within 30 days
    const expiringResult = await query(
      `SELECT
         a.*,
         p.first_name as patient_first_name,
         p.last_name as patient_last_name,
         p.mrn as patient_mrn,
         i.payer_name
       FROM authorizations a
       JOIN patients p ON a.patient_id = p.id AND p.clinic_id = a.clinic_id
       LEFT JOIN insurance i ON a.insurance_id = i.id AND i.clinic_id = a.clinic_id
       WHERE a.clinic_id = $1
         AND a.status = 'active'
         AND a.end_date <= (CURRENT_DATE + INTERVAL '30 days')
         AND a.end_date >= CURRENT_DATE
       ORDER BY a.end_date ASC`,
      [req.auth!.clinicId]
    );

    // Authorizations running low on visits (fewer than 3 remaining)
    const lowVisitsResult = await query(
      `SELECT
         a.*,
         p.first_name as patient_first_name,
         p.last_name as patient_last_name,
         p.mrn as patient_mrn,
         i.payer_name,
         (a.authorized_visits - a.used_visits) as remaining_visits
       FROM authorizations a
       JOIN patients p ON a.patient_id = p.id AND p.clinic_id = a.clinic_id
       LEFT JOIN insurance i ON a.insurance_id = i.id AND i.clinic_id = a.clinic_id
       WHERE a.clinic_id = $1
         AND a.status = 'active'
         AND (a.authorized_visits - a.used_visits) < 3
         AND (a.authorized_visits - a.used_visits) > 0
       ORDER BY (a.authorized_visits - a.used_visits) ASC`,
      [req.auth!.clinicId]
    );

    res.json({
      success: true,
      data: {
        expiring_soon: expiringResult.rows,
        low_visits: lowVisitsResult.rows,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Get Single Authorization ──
router.get('/:id', requirePermission(Permission.AUTHORIZATION_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
         a.*,
         p.first_name as patient_first_name,
         p.last_name as patient_last_name,
         p.mrn as patient_mrn,
         i.payer_name,
         i.member_id as insurance_member_id,
         i.plan_name as insurance_plan_name
       FROM authorizations a
       JOIN patients p ON a.patient_id = p.id AND p.clinic_id = a.clinic_id
       LEFT JOIN insurance i ON a.insurance_id = i.id AND i.clinic_id = a.clinic_id
       WHERE a.id = $1 AND a.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Authorization not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Create Authorization ──
router.post('/', requirePermission(Permission.AUTHORIZATION_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      patient_id: z.string().uuid(),
      insurance_id: z.string().uuid(),
      authorization_number: z.string().min(1).max(100),
      authorized_visits: z.number().int().positive(),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().max(2000).optional().nullable(),
    });
    const input = schema.parse(req.body);

    // Verify patient belongs to this clinic
    const patientCheck = await query(
      `SELECT id FROM patients WHERE id = $1 AND clinic_id = $2`,
      [input.patient_id, req.auth!.clinicId]
    );
    if (patientCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    // Verify insurance belongs to this clinic and patient
    const insuranceCheck = await query(
      `SELECT id FROM insurance WHERE id = $1 AND clinic_id = $2 AND patient_id = $3`,
      [input.insurance_id, req.auth!.clinicId, input.patient_id]
    );
    if (insuranceCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Insurance not found for this patient' });
      return;
    }

    // Validate date range
    if (new Date(input.end_date) <= new Date(input.start_date)) {
      res.status(400).json({ success: false, error: 'end_date must be after start_date' });
      return;
    }

    const result = await query(
      `INSERT INTO authorizations (clinic_id, patient_id, insurance_id, authorization_number, authorized_visits, used_visits, start_date, end_date, notes, status)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, 'active')
       RETURNING id`,
      [
        req.auth!.clinicId,
        input.patient_id,
        input.insurance_id,
        input.authorization_number,
        input.authorized_visits,
        input.start_date,
        input.end_date,
        input.notes || null,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.AUTHORIZATION_CREATE,
      resourceType: 'authorization',
      resourceId: result.rows[0].id,
      details: {
        patient_id: input.patient_id,
        authorization_number: input.authorization_number,
        authorized_visits: input.authorized_visits,
      },
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

// ── Update Authorization ──
router.put('/:id', requirePermission(Permission.AUTHORIZATION_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      authorization_number: z.string().min(1).max(100).optional(),
      authorized_visits: z.number().int().positive().optional(),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().max(2000).optional().nullable(),
      status: z.enum(['active', 'exhausted', 'expired', 'cancelled']).optional(),
    });
    const input = schema.parse(req.body);

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      authorization_number: 'authorization_number',
      authorized_visits: 'authorized_visits',
      start_date: 'start_date',
      end_date: 'end_date',
      notes: 'notes',
      status: 'status',
    };

    for (const [key, value] of Object.entries(input)) {
      if (fieldMap[key]) {
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
      `UPDATE authorizations SET ${fields.join(', ')}
       WHERE id = $1 AND clinic_id = $2
       RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Authorization not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.AUTHORIZATION_EDIT,
      resourceType: 'authorization',
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

// ── Increment Used Visits ──
router.put('/:id/increment', requirePermission(Permission.AUTHORIZATION_MANAGE), async (req: Request, res: Response) => {
  try {
    // Fetch current authorization
    const authResult = await query(
      `SELECT id, used_visits, authorized_visits, status
       FROM authorizations
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (authResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Authorization not found' });
      return;
    }

    const auth = authResult.rows[0];

    if (auth.status !== 'active') {
      res.status(400).json({ success: false, error: `Authorization is ${auth.status}, cannot increment visits` });
      return;
    }

    const newUsedVisits = auth.used_visits + 1;
    const newStatus = newUsedVisits >= auth.authorized_visits ? 'exhausted' : 'active';

    const updateResult = await query(
      `UPDATE authorizations
       SET used_visits = $3, status = $4, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING id, used_visits, authorized_visits, status`,
      [req.params.id, req.auth!.clinicId, newUsedVisits, newStatus]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.AUTHORIZATION_EDIT,
      resourceType: 'authorization',
      resourceId: req.params.id,
      details: {
        action: 'increment_visit',
        used_visits: newUsedVisits,
        authorized_visits: auth.authorized_visits,
        new_status: newStatus,
      },
      req,
    });

    res.json({
      success: true,
      data: updateResult.rows[0],
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
