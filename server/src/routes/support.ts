import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

const createRequestSchema = z.object({
  requestType: z.enum(['support', 'bug', 'feature']),
  subject: z.string().min(1).max(255),
  description: z.string().min(1).max(5000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

const updateRequestSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  devNotes: z.string().max(5000).optional(),
});

// List support requests — regular users see their own, dev/admin/owner see all
router.get('/', requirePermission(Permission.SUPPORT_CREATE), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const role = req.auth!.role;
    const canManage = ['owner', 'admin', 'dev'].includes(role);

    let sql: string;
    let params: unknown[];

    if (canManage) {
      // Dev/admin/owner see ALL requests across the clinic
      sql = `SELECT sr.*, u.first_name as submitted_first, u.last_name as submitted_last, u.username as submitted_username,
                    ru.first_name as resolved_first, ru.last_name as resolved_last
             FROM support_requests sr
             JOIN users u ON sr.submitted_by = u.id
             LEFT JOIN users ru ON sr.resolved_by = ru.id
             WHERE sr.clinic_id = $1
             ORDER BY
               CASE sr.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
               CASE sr.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
               sr.created_at DESC`;
      params = [clinicId];
    } else {
      // Regular users see only their own
      sql = `SELECT sr.*, u.first_name as submitted_first, u.last_name as submitted_last, u.username as submitted_username,
                    ru.first_name as resolved_first, ru.last_name as resolved_last
             FROM support_requests sr
             JOIN users u ON sr.submitted_by = u.id
             LEFT JOIN users ru ON sr.resolved_by = ru.id
             WHERE sr.clinic_id = $1 AND sr.submitted_by = $2
             ORDER BY sr.created_at DESC`;
      params = [clinicId, req.auth!.userId];
    }

    const result = await query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Create a support request — any logged-in user
router.post('/', requirePermission(Permission.SUPPORT_CREATE), async (req: Request, res: Response) => {
  try {
    const input = createRequestSchema.parse(req.body);
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;

    const result = await query(
      `INSERT INTO support_requests (clinic_id, submitted_by, request_type, subject, description, priority)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [clinicId, userId, input.requestType, input.subject, input.description, input.priority]
    );

    await logAudit({
      clinicId,
      userId,
      action: AuditAction.SUPPORT_CREATE,
      resourceType: 'support_request',
      resourceId: result.rows[0].id,
      details: { type: input.requestType, subject: input.subject },
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

// Update a support request — dev/admin/owner only
router.patch('/:id', requirePermission(Permission.SUPPORT_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = updateRequestSchema.parse(req.body);
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;

    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (input.status) {
      sets.push(`status = $${idx++}`);
      params.push(input.status);
      if (input.status === 'resolved' || input.status === 'closed') {
        sets.push(`resolved_by = $${idx++}`);
        params.push(userId);
        sets.push(`resolved_at = NOW()`);
      }
    }
    if (input.priority) {
      sets.push(`priority = $${idx++}`);
      params.push(input.priority);
    }
    if (input.devNotes !== undefined) {
      sets.push(`dev_notes = $${idx++}`);
      params.push(input.devNotes);
    }

    if (sets.length === 0) {
      res.status(400).json({ success: false, error: 'No updates provided' });
      return;
    }

    params.push(req.params.id); // $idx for id
    params.push(clinicId); // $idx+1 for clinic_id

    const result = await query(
      `UPDATE support_requests SET ${sets.join(', ')} WHERE id = $${idx++} AND clinic_id = $${idx}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Request not found' });
      return;
    }

    await logAudit({
      clinicId,
      userId,
      action: AuditAction.SUPPORT_UPDATE,
      resourceType: 'support_request',
      resourceId: req.params.id,
      details: { status: input.status, priority: input.priority },
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
