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
    const { patient_id, status, expiring_within_days, needs_followup, page = '1', limit = '25' } = req.query;
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

    if (needs_followup === 'true') {
      conditions.push(`a.status = 'pending'`);
      conditions.push(`a.follow_up_date IS NOT NULL`);
      conditions.push(`a.follow_up_date <= CURRENT_DATE`);
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

// ── Get Alerts (Pending Follow-ups) ──
// Must be defined BEFORE /:id so it does not get caught by the param route
router.get('/alerts/pending-followups', requirePermission(Permission.AUTHORIZATION_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
         a.id,
         a.authorization_number,
         a.authorized_visits,
         a.used_visits,
         a.start_date,
         a.end_date,
         a.status,
         a.follow_up_date,
         a.denial_reason,
         p.first_name as patient_first_name,
         p.last_name as patient_last_name,
         p.mrn as patient_mrn,
         i.payer_name
       FROM authorizations a
       JOIN patients p ON a.patient_id = p.id AND p.clinic_id = a.clinic_id
       LEFT JOIN insurance i ON a.insurance_id = i.id AND i.clinic_id = a.clinic_id
       WHERE a.clinic_id = $1
         AND a.status = 'pending'
         AND a.follow_up_date IS NOT NULL
         AND a.follow_up_date <= CURRENT_DATE
       ORDER BY a.follow_up_date ASC`,
      [req.auth!.clinicId]
    );

    const list = result.rows.map((row) => ({
      id: row.id,
      patient_name: `${row.patient_first_name} ${row.patient_last_name}`,
      payer: row.payer_name,
      follow_up_date: row.follow_up_date,
      authorization_number: row.authorization_number,
    }));

    res.json({
      success: true,
      data: {
        count: list.length,
        followups: list,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Generate Authorization Packet ──
// Compiles patient demographics, insurance, most recent eval note, and the
// latest plan of care into a JSON packet the client can render as print HTML.
router.post('/:id/packet', requirePermission(Permission.AUTHORIZATION_MANAGE), async (req: Request, res: Response) => {
  try {
    const authResult = await query(
      `SELECT * FROM authorizations WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (authResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Authorization not found' });
      return;
    }
    const auth = authResult.rows[0];

    // Patient demographics
    const patientResult = await query(
      `SELECT * FROM patients WHERE id = $1 AND clinic_id = $2`,
      [auth.patient_id, req.auth!.clinicId]
    );
    if (patientResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }
    const p = patientResult.rows[0];

    // Insurance record (optional)
    let insurance = null;
    if (auth.insurance_id) {
      const insuranceResult = await query(
        `SELECT * FROM insurance WHERE id = $1 AND clinic_id = $2`,
        [auth.insurance_id, req.auth!.clinicId]
      );
      if (insuranceResult.rows.length > 0) {
        const i = insuranceResult.rows[0];
        insurance = {
          payer_name: i.payer_name,
          payer_id: i.payer_id,
          plan_name: i.plan_name,
          member_id: i.member_id,
          group_number: i.group_number,
          subscriber_name: i.subscriber_name,
          subscriber_dob: i.subscriber_dob,
          coverage_start: i.coverage_start,
          coverage_end: i.coverage_end,
          eligibility_status: i.eligibility_status,
          eligibility_verified_at: i.eligibility_verified_at,
        };
      }
    }

    // Most recent eval-type clinical note
    const evalResult = await query(
      `SELECT cn.*, u.first_name AS author_first_name, u.last_name AS author_last_name
       FROM clinical_notes cn
       JOIN users u ON cn.author_id = u.id
       WHERE cn.patient_id = $1 AND cn.clinic_id = $2
         AND cn.note_type IN ('evaluation', 'eval')
       ORDER BY cn.created_at DESC
       LIMIT 1`,
      [auth.patient_id, req.auth!.clinicId]
    );
    const evalRow = evalResult.rows[0] || null;

    // Latest plan of care
    const pocResult = await query(
      `SELECT * FROM plans_of_care
       WHERE patient_id = $1 AND clinic_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [auth.patient_id, req.auth!.clinicId]
    );
    const pocRow = pocResult.rows[0] || null;

    const evalNote = evalRow
      ? {
          id: evalRow.id,
          note_type: evalRow.note_type,
          created_at: evalRow.created_at,
          author_name: `${evalRow.author_first_name} ${evalRow.author_last_name}`,
          subjective: evalRow.subjective,
          objective: evalRow.objective,
          assessment: evalRow.assessment,
          plan: evalRow.plan,
          icd10_codes: evalRow.icd10_codes,
          cpt_codes: evalRow.cpt_codes,
          signed_at: evalRow.signed_at,
        }
      : null;

    const planOfCare = pocRow
      ? {
          id: pocRow.id,
          start_date: pocRow.start_date,
          end_date: pocRow.end_date,
          frequency: pocRow.frequency,
          duration_weeks: pocRow.duration_weeks,
          diagnosis_codes: pocRow.diagnosis_codes,
          treatment_goals: pocRow.treatment_goals,
          physician_name: pocRow.physician_name,
          physician_npi: pocRow.physician_npi,
          certification_date: pocRow.certification_date,
          physician_signature_status: pocRow.physician_signature_status,
        }
      : null;

    const diagnosisCodes: string[] = Array.from(
      new Set<string>([
        ...((evalRow?.icd10_codes as string[] | null) || []),
        ...((pocRow?.diagnosis_codes as string[] | null) || []),
      ])
    );

    const justificationParts: string[] = [];
    if (evalRow?.assessment) justificationParts.push(`Assessment: ${evalRow.assessment}`);
    if (evalRow?.plan) justificationParts.push(`Plan: ${evalRow.plan}`);
    if (pocRow?.notes) justificationParts.push(`Plan of care notes: ${pocRow.notes}`);
    const clinicalJustification = justificationParts.join('\n\n');

    const packet = {
      generated_at: new Date().toISOString(),
      patient: {
        first_name: p.first_name,
        last_name: p.last_name,
        mrn: p.mrn,
        date_of_birth: p.date_of_birth,
        gender: p.gender,
        phone: p.phone,
        email: p.email,
        address_line1: p.address_line1,
        address_line2: p.address_line2,
        city: p.city,
        state: p.state,
        zip: p.zip,
      },
      insurance,
      authorization: {
        authorization_number: auth.authorization_number,
        authorized_visits: auth.authorized_visits,
        used_visits: auth.used_visits,
        start_date: auth.start_date,
        end_date: auth.end_date,
        status: auth.status,
        workflow_status: auth.workflow_status,
        follow_up_date: auth.follow_up_date,
        denial_reason: auth.denial_reason,
      },
      evalNote,
      planOfCare,
      diagnosisCodes,
      clinicalJustification,
    };

    await query(
      `UPDATE authorizations
       SET packet_data = $3, packet_generated_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId, JSON.stringify(packet)]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.AUTHORIZATION_EDIT,
      resourceType: 'authorization',
      resourceId: req.params.id,
      details: { action: 'packet_generated' },
      req,
    });

    res.json({ success: true, data: packet });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Get Stored Authorization Packet ──
// Must be defined BEFORE /:id so it does not get caught by the param route
router.get('/:id/packet', requirePermission(Permission.AUTHORIZATION_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT packet_data, packet_generated_at
       FROM authorizations
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Authorization not found' });
      return;
    }

    if (!result.rows[0].packet_data) {
      res.status(404).json({ success: false, error: 'No packet generated for this authorization' });
      return;
    }

    res.json({
      success: true,
      data: {
        packet: result.rows[0].packet_data,
        packet_generated_at: result.rows[0].packet_generated_at,
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
      authorization_number: z.string().min(1).max(100).optional().nullable(),
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
        input.authorization_number || null,
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
      authorization_number: z.string().min(1).max(100).optional().nullable(),
      authorized_visits: z.number().int().positive().optional(),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().max(2000).optional().nullable(),
      status: z.enum([
        'draft',
        'submitted',
        'pending',
        'approved',
        'denied',
        'expired',
        'active',
        'exhausted',
        'cancelled',
      ]).optional(),
      workflow_status: z.enum([
        'draft',
        'submitted',
        'pending',
        'approved',
        'denied',
        'expired',
      ]).optional(),
      follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      denial_reason: z.string().max(2000).optional().nullable(),
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
      workflow_status: 'workflow_status',
      follow_up_date: 'follow_up_date',
      denial_reason: 'denial_reason',
    };

    for (const [key, value] of Object.entries(input)) {
      if (fieldMap[key]) {
        fields.push(`${fieldMap[key]} = $${idx++}`);
        values.push(value ?? null);
      }
    }

    // Transitioning to submitted stamps the submission time automatically
    if (input.workflow_status === 'submitted' || input.status === 'submitted') {
      fields.push(`submitted_at = NOW()`);
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
