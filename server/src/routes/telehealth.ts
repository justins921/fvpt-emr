import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();

// ── Public routes (no auth required) ──

// Get session by room_id — used by patients joining via link
router.get('/room/:roomId', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
        ts.id,
        ts.room_id,
        ts.room_url,
        ts.patient_url,
        ts.status,
        ts.started_at,
        ts.ended_at,
        ts.created_at,
        p.first_name as patient_first_name,
        p.last_name as patient_last_name,
        u.first_name as therapist_first_name,
        u.last_name as therapist_last_name,
        u.credential as therapist_credential
      FROM telehealth_sessions ts
      JOIN patients p ON ts.patient_id = p.id
      JOIN users u ON ts.therapist_id = u.id
      WHERE ts.room_id = $1`,
      [req.params.roomId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    const session = result.rows[0];

    // Return minimal info for patient access — no clinic internals
    res.json({
      success: true,
      data: {
        id: session.id,
        room_id: session.room_id,
        room_url: session.room_url,
        patient_url: session.patient_url,
        status: session.status,
        started_at: session.started_at,
        ended_at: session.ended_at,
        created_at: session.created_at,
        patient_name: `${session.patient_first_name} ${session.patient_last_name}`,
        therapist_name: `${session.therapist_first_name} ${session.therapist_last_name}`,
        therapist_credential: session.therapist_credential,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Staff routes (authenticated) ──

router.use(authenticate, validateSession, tenantScope);

const createSessionSchema = z.object({
  appointmentId: z.string().uuid().optional().nullable(),
  patientId: z.string().uuid(),
  therapistId: z.string().uuid(),
  scheduledAt: z.string().optional().nullable(),
});

// Create telehealth session
router.post('/', requirePermission(Permission.TELEHEALTH_CREATE), async (req: Request, res: Response) => {
  try {
    const input = createSessionSchema.parse(req.body);

    // Verify patient belongs to this clinic
    const patientCheck = await query(
      `SELECT id FROM patients WHERE id = $1 AND clinic_id = $2`,
      [input.patientId, req.auth!.clinicId]
    );
    if (patientCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    // Verify therapist belongs to this clinic
    const therapistCheck = await query(
      `SELECT id FROM users WHERE id = $1 AND clinic_id = $2 AND is_active = true`,
      [input.therapistId, req.auth!.clinicId]
    );
    if (therapistCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Therapist not found' });
      return;
    }

    // Verify appointment belongs to this clinic if provided
    if (input.appointmentId) {
      const appointmentCheck = await query(
        `SELECT id FROM appointments WHERE id = $1 AND clinic_id = $2`,
        [input.appointmentId, req.auth!.clinicId]
      );
      if (appointmentCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Appointment not found' });
        return;
      }
    }

    const roomId = crypto.randomUUID();
    const roomUrl = `/telehealth/room/${roomId}`;
    const patientUrl = `/telehealth/join/${roomId}`;

    const result = await query(
      `INSERT INTO telehealth_sessions (
        clinic_id, appointment_id, patient_id, therapist_id,
        room_id, room_url, patient_url, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
      RETURNING id, room_id, room_url, patient_url, status, created_at`,
      [
        req.auth!.clinicId,
        input.appointmentId || null,
        input.patientId,
        input.therapistId,
        roomId,
        roomUrl,
        patientUrl,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.TELEHEALTH_CREATE,
      resourceType: 'telehealth_session',
      resourceId: result.rows[0].id,
      details: {
        patientId: input.patientId,
        therapistId: input.therapistId,
        appointmentId: input.appointmentId || null,
      },
      req,
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// List telehealth sessions with filters and pagination
router.get('/', requirePermission(Permission.TELEHEALTH_VIEW), async (req: Request, res: Response) => {
  try {
    const { therapistId, patientId, status, startDate, endDate, page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = ['ts.clinic_id = $1'];
    const params: unknown[] = [req.auth!.clinicId];
    let paramIndex = 2;

    if (therapistId) {
      conditions.push(`ts.therapist_id = $${paramIndex++}`);
      params.push(therapistId);
    }

    if (patientId) {
      conditions.push(`ts.patient_id = $${paramIndex++}`);
      params.push(patientId);
    }

    if (status) {
      conditions.push(`ts.status = $${paramIndex++}`);
      params.push(status);
    }

    if (startDate) {
      conditions.push(`ts.created_at >= $${paramIndex++}`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`ts.created_at <= $${paramIndex++}`);
      params.push(endDate);
    }

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) as total FROM telehealth_sessions ts WHERE ${where}`,
      params
    );

    const result = await query(
      `SELECT
        ts.*,
        p.first_name as patient_first_name,
        p.last_name as patient_last_name,
        p.mrn,
        u.first_name as therapist_first_name,
        u.last_name as therapist_last_name,
        u.credential as therapist_credential
      FROM telehealth_sessions ts
      JOIN patients p ON ts.patient_id = p.id
      JOIN users u ON ts.therapist_id = u.id
      WHERE ${where}
      ORDER BY ts.created_at DESC
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

// Get single telehealth session
router.get('/:id', requirePermission(Permission.TELEHEALTH_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
        ts.*,
        p.first_name as patient_first_name,
        p.last_name as patient_last_name,
        p.mrn,
        u.first_name as therapist_first_name,
        u.last_name as therapist_last_name,
        u.credential as therapist_credential
      FROM telehealth_sessions ts
      JOIN patients p ON ts.patient_id = p.id
      JOIN users u ON ts.therapist_id = u.id
      WHERE ts.id = $1 AND ts.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Telehealth session not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Start telehealth session
router.put('/:id/start', requirePermission(Permission.TELEHEALTH_CREATE), async (req: Request, res: Response) => {
  try {
    // Verify session exists and is in a startable state
    const existing = await query(
      `SELECT id, status FROM telehealth_sessions WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Telehealth session not found' });
      return;
    }

    if (existing.rows[0].status !== 'scheduled') {
      res.status(400).json({
        success: false,
        error: `Cannot start session with status "${existing.rows[0].status}". Session must be in "scheduled" status.`,
      });
      return;
    }

    const result = await query(
      `UPDATE telehealth_sessions
       SET status = 'in_progress', started_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      [req.params.id, req.auth!.clinicId]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.TELEHEALTH_START,
      resourceType: 'telehealth_session',
      resourceId: req.params.id,
      req,
    });

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// End telehealth session
router.put('/:id/end', requirePermission(Permission.TELEHEALTH_CREATE), async (req: Request, res: Response) => {
  try {
    // Verify session exists and is in progress
    const existing = await query(
      `SELECT id, status, started_at FROM telehealth_sessions WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Telehealth session not found' });
      return;
    }

    if (existing.rows[0].status !== 'in_progress') {
      res.status(400).json({
        success: false,
        error: `Cannot end session with status "${existing.rows[0].status}". Session must be in "in_progress" status.`,
      });
      return;
    }

    // Calculate duration in minutes from started_at to now
    const result = await query(
      `UPDATE telehealth_sessions
       SET status = 'completed',
           ended_at = NOW(),
           duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at)) / 60
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      [req.params.id, req.auth!.clinicId]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.TELEHEALTH_END,
      resourceType: 'telehealth_session',
      resourceId: req.params.id,
      details: {
        durationMinutes: result.rows[0].duration_minutes,
      },
      req,
    });

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
