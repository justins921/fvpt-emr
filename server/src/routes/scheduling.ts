import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction, AppointmentType, AppointmentStatus } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

const appointmentSchema = z.object({
  patientId: z.string().uuid(),
  therapistId: z.string().uuid(),
  locationId: z.string().uuid().optional().nullable(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  appointmentType: z.nativeEnum(AppointmentType),
  notes: z.string().optional().nullable(),
  recurringRule: z.string().optional().nullable(),
});

// Get appointments for date range
router.get('/', requirePermission(Permission.SCHEDULE_VIEW), async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, therapistId, locationId } = req.query;
    if (!startDate || !endDate) {
      res.status(400).json({ success: false, error: 'startDate and endDate required' });
      return;
    }

    let sql = `
      SELECT a.*,
        p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
        u.first_name as therapist_first_name, u.last_name as therapist_last_name, u.credential as therapist_credential,
        cl.name as location_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN users u ON a.therapist_id = u.id
      LEFT JOIN clinic_locations cl ON a.location_id = cl.id
      WHERE a.clinic_id = $1 AND a.start_time >= $2 AND a.end_time <= $3
    `;
    const params: unknown[] = [req.auth!.clinicId, startDate, endDate];
    let paramIdx = 4;

    if (therapistId) {
      sql += ` AND a.therapist_id = $${paramIdx++}`;
      params.push(therapistId);
    }
    if (locationId) {
      sql += ` AND a.location_id = $${paramIdx++}`;
      params.push(locationId);
    }
    sql += ` ORDER BY a.start_time`;

    const result = await query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Create appointment
router.post('/', requirePermission(Permission.SCHEDULE_CREATE), async (req: Request, res: Response) => {
  try {
    const input = appointmentSchema.parse(req.body);

    // Conflict detection
    const conflicts = await query(
      `SELECT id FROM appointments 
       WHERE clinic_id = $1 AND therapist_id = $2 
       AND status NOT IN ('cancelled')
       AND start_time < $4 AND end_time > $3`,
      [req.auth!.clinicId, input.therapistId, input.startTime, input.endTime]
    );

    if (conflicts.rows.length > 0) {
      res.status(409).json({
        success: false,
        error: 'Scheduling conflict: therapist has overlapping appointment',
        data: { conflictingIds: conflicts.rows.map(r => r.id) },
      });
      return;
    }

    // Patient conflict detection
    const patientConflicts = await query(
      `SELECT id FROM appointments 
       WHERE clinic_id = $1 AND patient_id = $2 
       AND status NOT IN ('cancelled')
       AND start_time < $4 AND end_time > $3`,
      [req.auth!.clinicId, input.patientId, input.startTime, input.endTime]
    );

    if (patientConflicts.rows.length > 0) {
      res.status(409).json({
        success: false,
        error: 'Scheduling conflict: patient has overlapping appointment',
      });
      return;
    }

    // Authorization-aware scheduling: warn (don't block) when the appointment
    // would exceed authorized visits, fall outside an authorization's dates,
    // or when the patient has no usable authorization on file.
    const authWarnings: string[] = [];
    // Usable = payer-approved via the workflow (new source of truth), or legacy
    // status='active' for records created before the workflow_status column.
    const authResult = await query(
      `SELECT authorization_number, authorized_visits, used_visits, end_date, workflow_status, status
       FROM authorizations
       WHERE clinic_id = $1 AND patient_id = $2
         AND (workflow_status = 'approved' OR (workflow_status = 'draft' AND status = 'active'))`,
      [req.auth!.clinicId, input.patientId]
    );
    if (authResult.rows.length === 0) {
      authWarnings.push('Patient has no active authorization on file — verify coverage before this visit');
    }
    const apptDate = input.startTime.slice(0, 10); // YYYY-MM-DD
    for (const auth of authResult.rows) {
      const used = Number(auth.used_visits) || 0;
      const authorized = Number(auth.authorized_visits) || 0;
      const authLabel = auth.authorization_number || 'authorization';
      if (used + 1 > authorized) {
        authWarnings.push(
          `Authorization ${authLabel}: this visit would exceed authorized visits (${used}/${authorized} used)`
        );
      } else if (authorized - used <= 2) {
        authWarnings.push(
          `Authorization ${authLabel}: only ${authorized - used} visit${authorized - used === 1 ? '' : 's'} remaining`
        );
      }
      // end_date may come back as a Date object or YYYY-MM-DD string; normalize
      const endDateStr = auth.end_date instanceof Date
        ? auth.end_date.toISOString().slice(0, 10)
        : String(auth.end_date || '').slice(0, 10);
      if (endDateStr && endDateStr < apptDate) {
        authWarnings.push(
          `Authorization ${authLabel} expires ${endDateStr} before this appointment`
        );
      }
    }

    const result = await query(
      `INSERT INTO appointments (clinic_id, patient_id, therapist_id, location_id, start_time, end_time, appointment_type, notes, recurring_rule)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [req.auth!.clinicId, input.patientId, input.therapistId, input.locationId || null, input.startTime, input.endTime, input.appointmentType, input.notes || null, input.recurringRule || null]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.APPOINTMENT_CREATE,
      resourceType: 'appointment',
      resourceId: result.rows[0].id,
      req,
    });

    res.status(201).json({ success: true, data: { id: result.rows[0].id, warnings: authWarnings } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Update appointment status
router.patch('/:id/status', requirePermission(Permission.SCHEDULE_EDIT), async (req: Request, res: Response) => {
  try {
    const { status } = z.object({ status: z.nativeEnum(AppointmentStatus) }).parse(req.body);

    const result = await query(
      `UPDATE appointments SET status = $3 WHERE id = $1 AND clinic_id = $2 RETURNING id, status`,
      [req.params.id, req.auth!.clinicId, status]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Appointment not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: status === AppointmentStatus.CANCELLED ? AuditAction.APPOINTMENT_CANCEL : AuditAction.APPOINTMENT_EDIT,
      resourceType: 'appointment',
      resourceId: req.params.id,
      details: { newStatus: status },
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

// Update full appointment
router.put('/:id', requirePermission(Permission.SCHEDULE_EDIT), async (req: Request, res: Response) => {
  try {
    const input = appointmentSchema.partial().parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      patientId: 'patient_id', therapistId: 'therapist_id',
      locationId: 'location_id', startTime: 'start_time',
      endTime: 'end_time', appointmentType: 'appointment_type',
      notes: 'notes',
    };

    for (const [key, value] of Object.entries(input)) {
      if (fieldMap[key]) {
        fields.push(`${fieldMap[key]} = $${idx++}`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    const result = await query(
      `UPDATE appointments SET ${fields.join(', ')} WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Appointment not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.APPOINTMENT_EDIT,
      resourceType: 'appointment',
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

export default router;
