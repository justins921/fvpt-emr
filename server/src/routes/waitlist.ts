import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Schemas ──

const waitlistStatusEnum = z.enum(['waiting', 'contacted', 'scheduled', 'cancelled', 'expired']);
const urgencyEnum = z.enum(['low', 'normal', 'high', 'urgent']);
const dayEnum = z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

const createWaitlistSchema = z.object({
  patientId: z.string().uuid(),
  preferredTherapistId: z.string().uuid().optional().nullable(),
  preferredDays: z.array(dayEnum).optional().nullable(),
  preferredTimeStart: z.string().optional().nullable(),
  preferredTimeEnd: z.string().optional().nullable(),
  urgency: urgencyEnum,
  appointmentType: z.string().min(1),
  notes: z.string().optional().nullable(),
});

const updateWaitlistSchema = createWaitlistSchema.partial().extend({
  status: waitlistStatusEnum.optional(),
});

const contactSchema = z.object({
  contactNotes: z.string().optional().nullable(),
});

const scheduleSchema = z.object({
  scheduledAppointmentId: z.string().uuid(),
});

// ── Helpers ──

const URGENCY_ORDER: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 };

// ── GET /match ── Find matching waitlist entries for an open slot
// (Defined before /:id to avoid route conflict)
router.get('/match', requirePermission(Permission.WAITLIST_VIEW), async (req: Request, res: Response) => {
  try {
    const { therapist_id, day_of_week, time_start, time_end } = req.query;

    if (!therapist_id || !day_of_week || !time_start || !time_end) {
      res.status(400).json({
        success: false,
        error: 'therapist_id, day_of_week, time_start, and time_end are required',
      });
      return;
    }

    const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    if (!validDays.includes((day_of_week as string).toLowerCase())) {
      res.status(400).json({ success: false, error: 'Invalid day_of_week' });
      return;
    }

    // Find waitlist entries that:
    // 1. Are in 'waiting' or 'contacted' status (still active)
    // 2. Prefer this therapist (or have no preference)
    // 3. Have the requested day in their preferred_days (or have no day preference)
    // 4. Have overlapping time preferences (or have no time preference)
    const result = await query(
      `SELECT w.*,
        p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn, p.phone as patient_phone
       FROM waitlist_entries w
       JOIN patients p ON w.patient_id = p.id AND p.clinic_id = w.clinic_id
       WHERE w.clinic_id = $1
         AND w.status IN ('waiting', 'contacted')
         AND (w.preferred_therapist_id IS NULL OR w.preferred_therapist_id = $2)
         AND (w.preferred_days IS NULL OR $3 = ANY(w.preferred_days))
         AND (w.preferred_time_start IS NULL OR w.preferred_time_start <= $5)
         AND (w.preferred_time_end IS NULL OR w.preferred_time_end >= $4)
       ORDER BY
         CASE w.urgency
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'normal' THEN 3
           WHEN 'low' THEN 4
         END ASC,
         w.created_at ASC`,
      [
        req.auth!.clinicId,
        therapist_id,
        (day_of_week as string).toLowerCase(),
        time_start,
        time_end,
      ]
    );

    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET / ── List waitlist entries
router.get('/', requirePermission(Permission.WAITLIST_VIEW), async (req: Request, res: Response) => {
  try {
    const { status, urgency, preferred_therapist_id, page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = ['w.clinic_id = $1'];
    const params: unknown[] = [req.auth!.clinicId];
    let paramIndex = 2;

    if (status) {
      const parsed = waitlistStatusEnum.safeParse(status);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'Invalid status filter' });
        return;
      }
      conditions.push(`w.status = $${paramIndex++}`);
      params.push(status);
    }

    if (urgency) {
      const parsed = urgencyEnum.safeParse(urgency);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'Invalid urgency filter' });
        return;
      }
      conditions.push(`w.urgency = $${paramIndex++}`);
      params.push(urgency);
    }

    if (preferred_therapist_id) {
      conditions.push(`w.preferred_therapist_id = $${paramIndex++}`);
      params.push(preferred_therapist_id);
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) as total FROM waitlist_entries w WHERE ${whereClause}`,
      params
    );

    const result = await query(
      `SELECT w.*,
        p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn, p.phone as patient_phone,
        u.first_name as therapist_first_name, u.last_name as therapist_last_name
       FROM waitlist_entries w
       JOIN patients p ON w.patient_id = p.id AND p.clinic_id = w.clinic_id
       LEFT JOIN users u ON w.preferred_therapist_id = u.id
       WHERE ${whereClause}
       ORDER BY
         CASE w.urgency
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'normal' THEN 3
           WHEN 'low' THEN 4
         END ASC,
         w.created_at ASC
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

// ── GET /:id ── Get single waitlist entry
router.get('/:id', requirePermission(Permission.WAITLIST_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT w.*,
        p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn, p.phone as patient_phone,
        u.first_name as therapist_first_name, u.last_name as therapist_last_name
       FROM waitlist_entries w
       JOIN patients p ON w.patient_id = p.id AND p.clinic_id = w.clinic_id
       LEFT JOIN users u ON w.preferred_therapist_id = u.id
       WHERE w.id = $1 AND w.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Waitlist entry not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST / ── Add to waitlist
router.post('/', requirePermission(Permission.WAITLIST_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = createWaitlistSchema.parse(req.body);

    // Verify patient belongs to this clinic
    const patientCheck = await query(
      `SELECT id FROM patients WHERE id = $1 AND clinic_id = $2`,
      [input.patientId, req.auth!.clinicId]
    );
    if (patientCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    // Verify therapist belongs to this clinic (if specified)
    if (input.preferredTherapistId) {
      const therapistCheck = await query(
        `SELECT id FROM users WHERE id = $1 AND clinic_id = $2 AND is_active = true`,
        [input.preferredTherapistId, req.auth!.clinicId]
      );
      if (therapistCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Therapist not found' });
        return;
      }
    }

    const result = await query(
      `INSERT INTO waitlist_entries (
        clinic_id, patient_id, preferred_therapist_id, preferred_days,
        preferred_time_start, preferred_time_end, urgency,
        appointment_type, notes, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'waiting', $10)
      RETURNING id`,
      [
        req.auth!.clinicId,
        input.patientId,
        input.preferredTherapistId || null,
        input.preferredDays || null,
        input.preferredTimeStart || null,
        input.preferredTimeEnd || null,
        input.urgency,
        input.appointmentType,
        input.notes || null,
        req.auth!.userId,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.WAITLIST_ADD,
      resourceType: 'waitlist_entry',
      resourceId: result.rows[0].id,
      details: { patientId: input.patientId, urgency: input.urgency },
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

// ── PUT /:id ── Update waitlist entry
router.put('/:id', requirePermission(Permission.WAITLIST_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = updateWaitlistSchema.parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      patientId: 'patient_id',
      preferredTherapistId: 'preferred_therapist_id',
      preferredDays: 'preferred_days',
      preferredTimeStart: 'preferred_time_start',
      preferredTimeEnd: 'preferred_time_end',
      urgency: 'urgency',
      appointmentType: 'appointment_type',
      notes: 'notes',
      status: 'status',
    };

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

    // Always update the updated_at timestamp
    fields.push(`updated_at = NOW()`);

    const result = await query(
      `UPDATE waitlist_entries SET ${fields.join(', ')} WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Waitlist entry not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.WAITLIST_UPDATE,
      resourceType: 'waitlist_entry',
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

// ── PUT /:id/contact ── Mark as contacted
router.put('/:id/contact', requirePermission(Permission.WAITLIST_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = contactSchema.parse(req.body);

    const result = await query(
      `UPDATE waitlist_entries
       SET status = 'contacted', contacted_at = NOW(), contacted_by = $3, contact_notes = $4, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2 AND status IN ('waiting')
       RETURNING id, status, contacted_at`,
      [req.params.id, req.auth!.clinicId, req.auth!.userId, input.contactNotes || null]
    );

    if (result.rows.length === 0) {
      // Check if entry exists at all
      const exists = await query(
        `SELECT id, status FROM waitlist_entries WHERE id = $1 AND clinic_id = $2`,
        [req.params.id, req.auth!.clinicId]
      );
      if (exists.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Waitlist entry not found' });
        return;
      }
      res.status(409).json({
        success: false,
        error: `Cannot contact entry with status '${exists.rows[0].status}'`,
      });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.WAITLIST_UPDATE,
      resourceType: 'waitlist_entry',
      resourceId: req.params.id,
      details: { action: 'contacted' },
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

// ── PUT /:id/schedule ── Mark as scheduled, link to appointment
router.put('/:id/schedule', requirePermission(Permission.WAITLIST_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = scheduleSchema.parse(req.body);

    // Verify the appointment exists and belongs to this clinic
    const appointmentCheck = await query(
      `SELECT id FROM appointments WHERE id = $1 AND clinic_id = $2`,
      [input.scheduledAppointmentId, req.auth!.clinicId]
    );
    if (appointmentCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Appointment not found' });
      return;
    }

    const result = await query(
      `UPDATE waitlist_entries
       SET status = 'scheduled', scheduled_appointment_id = $3, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2 AND status IN ('waiting', 'contacted')
       RETURNING id, status, scheduled_appointment_id`,
      [req.params.id, req.auth!.clinicId, input.scheduledAppointmentId]
    );

    if (result.rows.length === 0) {
      const exists = await query(
        `SELECT id, status FROM waitlist_entries WHERE id = $1 AND clinic_id = $2`,
        [req.params.id, req.auth!.clinicId]
      );
      if (exists.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Waitlist entry not found' });
        return;
      }
      res.status(409).json({
        success: false,
        error: `Cannot schedule entry with status '${exists.rows[0].status}'`,
      });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.WAITLIST_UPDATE,
      resourceType: 'waitlist_entry',
      resourceId: req.params.id,
      details: { action: 'scheduled', appointmentId: input.scheduledAppointmentId },
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

// ── DELETE /:id ── Cancel waitlist entry (soft delete via status)
router.delete('/:id', requirePermission(Permission.WAITLIST_MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE waitlist_entries
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2 AND status NOT IN ('cancelled', 'scheduled')
       RETURNING id, status`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      const exists = await query(
        `SELECT id, status FROM waitlist_entries WHERE id = $1 AND clinic_id = $2`,
        [req.params.id, req.auth!.clinicId]
      );
      if (exists.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Waitlist entry not found' });
        return;
      }
      res.status(409).json({
        success: false,
        error: `Cannot cancel entry with status '${exists.rows[0].status}'`,
      });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.WAITLIST_UPDATE,
      resourceType: 'waitlist_entry',
      resourceId: req.params.id,
      details: { action: 'cancelled' },
      req,
    });

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
