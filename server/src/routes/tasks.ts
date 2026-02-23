import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Zod Schemas ──

const taskCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional().nullable(),
  assignedTo: z.string().uuid(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  dueDate: z.string().datetime().optional().nullable(),
  patientId: z.string().uuid().optional().nullable(),
  category: z.enum(['clinical', 'billing', 'admin', 'follow_up', 'documentation', 'other']).optional().nullable(),
});

const taskUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional().nullable(),
  assignedTo: z.string().uuid().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  dueDate: z.string().datetime().optional().nullable(),
  patientId: z.string().uuid().optional().nullable(),
  category: z.enum(['clinical', 'billing', 'admin', 'follow_up', 'documentation', 'other']).optional().nullable(),
});

// ── GET /summary - Task counts grouped by status and priority ──
router.get('/summary', requirePermission(Permission.TASK_VIEW), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;

    const [statusResult, priorityResult, overdueResult] = await Promise.all([
      query(
        `SELECT status, COUNT(*) as count
         FROM tasks
         WHERE clinic_id = $1
         GROUP BY status`,
        [clinicId]
      ),
      query(
        `SELECT priority, COUNT(*) as count
         FROM tasks
         WHERE clinic_id = $1 AND status NOT IN ('completed', 'cancelled')
         GROUP BY priority`,
        [clinicId]
      ),
      query(
        `SELECT COUNT(*) as count
         FROM tasks
         WHERE clinic_id = $1 AND status NOT IN ('completed', 'cancelled')
           AND due_date IS NOT NULL AND due_date < NOW()`,
        [clinicId]
      ),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of statusResult.rows) {
      byStatus[row.status] = parseInt(row.count, 10);
    }

    const byPriority: Record<string, number> = {};
    for (const row of priorityResult.rows) {
      byPriority[row.priority] = parseInt(row.count, 10);
    }

    res.json({
      success: true,
      data: {
        byStatus,
        byPriority,
        overdue: parseInt(overdueResult.rows[0].count, 10),
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /my - Tasks assigned to current user ──
router.get('/my', requirePermission(Permission.TASK_VIEW), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;
    const { status, priority } = req.query;

    const conditions: string[] = ['t.clinic_id = $1', 't.assigned_to = $2'];
    const params: unknown[] = [clinicId, userId];
    let idx = 3;

    if (status) {
      conditions.push(`t.status = $${idx++}`);
      params.push(status);
    }
    if (priority) {
      conditions.push(`t.priority = $${idx++}`);
      params.push(priority);
    }

    const result = await query(
      `SELECT t.*,
        au.first_name as assigned_to_first_name, au.last_name as assigned_to_last_name,
        bu.first_name as assigned_by_first_name, bu.last_name as assigned_by_last_name,
        p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn as patient_mrn
       FROM tasks t
       JOIN users au ON t.assigned_to = au.id
       JOIN users bu ON t.assigned_by = bu.id
       LEFT JOIN patients p ON t.patient_id = p.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END,
         t.due_date ASC NULLS LAST,
         t.created_at DESC`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET / - List tasks with filters and pagination ──
router.get('/', requirePermission(Permission.TASK_VIEW), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const {
      assigned_to, status, priority, category, patient_id,
      due_date_from, due_date_to, overdue,
      page = '1', limit = '25',
    } = req.query;

    const conditions: string[] = ['t.clinic_id = $1'];
    const params: unknown[] = [clinicId];
    let idx = 2;

    if (assigned_to) {
      conditions.push(`t.assigned_to = $${idx++}`);
      params.push(assigned_to);
    }
    if (status) {
      conditions.push(`t.status = $${idx++}`);
      params.push(status);
    }
    if (priority) {
      conditions.push(`t.priority = $${idx++}`);
      params.push(priority);
    }
    if (category) {
      conditions.push(`t.category = $${idx++}`);
      params.push(category);
    }
    if (patient_id) {
      conditions.push(`t.patient_id = $${idx++}`);
      params.push(patient_id);
    }
    if (due_date_from) {
      conditions.push(`t.due_date >= $${idx++}`);
      params.push(due_date_from);
    }
    if (due_date_to) {
      conditions.push(`t.due_date <= $${idx++}`);
      params.push(due_date_to);
    }
    if (overdue === 'true') {
      conditions.push(`t.due_date IS NOT NULL AND t.due_date < NOW() AND t.status NOT IN ('completed', 'cancelled')`);
    }

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, parseInt(limit as string, 10));

    const countResult = await query(
      `SELECT COUNT(*) as total FROM tasks t WHERE ${conditions.join(' AND ')}`,
      params
    );

    const result = await query(
      `SELECT t.*,
        au.first_name as assigned_to_first_name, au.last_name as assigned_to_last_name,
        bu.first_name as assigned_by_first_name, bu.last_name as assigned_by_last_name,
        p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn as patient_mrn
       FROM tasks t
       JOIN users au ON t.assigned_to = au.id
       JOIN users bu ON t.assigned_by = bu.id
       LEFT JOIN patients p ON t.patient_id = p.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END,
         t.due_date ASC NULLS LAST,
         t.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limitNum, (pageNum - 1) * limitNum]
    );

    res.json({
      success: true,
      data: result.rows,
      meta: { page: pageNum, limit: limitNum, total: parseInt(countResult.rows[0].total, 10) },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /:id - Get single task ──
router.get('/:id', requirePermission(Permission.TASK_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT t.*,
        au.first_name as assigned_to_first_name, au.last_name as assigned_to_last_name,
        bu.first_name as assigned_by_first_name, bu.last_name as assigned_by_last_name,
        cu.first_name as completed_by_first_name, cu.last_name as completed_by_last_name,
        p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn as patient_mrn
       FROM tasks t
       JOIN users au ON t.assigned_to = au.id
       JOIN users bu ON t.assigned_by = bu.id
       LEFT JOIN users cu ON t.completed_by = cu.id
       LEFT JOIN patients p ON t.patient_id = p.id
       WHERE t.id = $1 AND t.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST / - Create task ──
router.post('/', requirePermission(Permission.TASK_CREATE), async (req: Request, res: Response) => {
  try {
    const input = taskCreateSchema.parse(req.body);
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;

    // Verify assigned user belongs to same clinic
    const assigneeResult = await query(
      `SELECT id FROM users WHERE id = $1 AND clinic_id = $2 AND is_active = true`,
      [input.assignedTo, clinicId]
    );
    if (assigneeResult.rows.length === 0) {
      res.status(400).json({ success: false, error: 'Assigned user not found or inactive' });
      return;
    }

    // Verify patient belongs to same clinic if provided
    if (input.patientId) {
      const patientResult = await query(
        `SELECT id FROM patients WHERE id = $1 AND clinic_id = $2`,
        [input.patientId, clinicId]
      );
      if (patientResult.rows.length === 0) {
        res.status(400).json({ success: false, error: 'Patient not found' });
        return;
      }
    }

    const result = await query(
      `INSERT INTO tasks (clinic_id, title, description, assigned_to, assigned_by, priority, status, due_date, patient_id, category)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
       RETURNING id`,
      [
        clinicId,
        input.title,
        input.description || null,
        input.assignedTo,
        userId,
        input.priority,
        input.dueDate || null,
        input.patientId || null,
        input.category || null,
      ]
    );

    await logAudit({
      clinicId,
      userId,
      action: AuditAction.TASK_CREATE,
      resourceType: 'task',
      resourceId: result.rows[0].id,
      details: { title: input.title, assignedTo: input.assignedTo, priority: input.priority },
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

// ── PUT /:id - Update task ──
router.put('/:id', requirePermission(Permission.TASK_CREATE), async (req: Request, res: Response) => {
  try {
    const input = taskUpdateSchema.parse(req.body);
    const clinicId = req.auth!.clinicId;

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      title: 'title',
      description: 'description',
      assignedTo: 'assigned_to',
      priority: 'priority',
      status: 'status',
      dueDate: 'due_date',
      patientId: 'patient_id',
      category: 'category',
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

    // Verify assigned user belongs to same clinic if being changed
    if (input.assignedTo) {
      const assigneeResult = await query(
        `SELECT id FROM users WHERE id = $1 AND clinic_id = $2 AND is_active = true`,
        [input.assignedTo, clinicId]
      );
      if (assigneeResult.rows.length === 0) {
        res.status(400).json({ success: false, error: 'Assigned user not found or inactive' });
        return;
      }
    }

    // Verify patient belongs to same clinic if being changed
    if (input.patientId) {
      const patientResult = await query(
        `SELECT id FROM patients WHERE id = $1 AND clinic_id = $2`,
        [input.patientId, clinicId]
      );
      if (patientResult.rows.length === 0) {
        res.status(400).json({ success: false, error: 'Patient not found' });
        return;
      }
    }

    fields.push(`updated_at = NOW()`);

    const result = await query(
      `UPDATE tasks SET ${fields.join(', ')} WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [req.params.id, clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    await logAudit({
      clinicId,
      userId: req.auth!.userId,
      action: AuditAction.TASK_UPDATE,
      resourceType: 'task',
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

// ── PUT /:id/complete - Mark task as completed ──
router.put('/:id/complete', requirePermission(Permission.TASK_CREATE), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;

    const result = await query(
      `UPDATE tasks
       SET status = 'completed', completed_at = NOW(), completed_by = $3, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2 AND status NOT IN ('completed', 'cancelled')
       RETURNING id`,
      [req.params.id, clinicId, userId]
    );

    if (result.rows.length === 0) {
      // Check if it exists at all
      const exists = await query(
        `SELECT id, status FROM tasks WHERE id = $1 AND clinic_id = $2`,
        [req.params.id, clinicId]
      );
      if (exists.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }
      res.status(409).json({ success: false, error: `Task is already ${exists.rows[0].status}` });
      return;
    }

    await logAudit({
      clinicId,
      userId,
      action: AuditAction.TASK_COMPLETE,
      resourceType: 'task',
      resourceId: req.params.id,
      req,
    });

    res.json({ success: true, data: { id: req.params.id } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── DELETE /:id - Cancel task (soft delete) ──
router.delete('/:id', requirePermission(Permission.TASK_CREATE), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;

    const result = await query(
      `UPDATE tasks
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2 AND status NOT IN ('completed', 'cancelled')
       RETURNING id`,
      [req.params.id, clinicId]
    );

    if (result.rows.length === 0) {
      const exists = await query(
        `SELECT id, status FROM tasks WHERE id = $1 AND clinic_id = $2`,
        [req.params.id, clinicId]
      );
      if (exists.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }
      res.status(409).json({ success: false, error: `Task is already ${exists.rows[0].status}` });
      return;
    }

    await logAudit({
      clinicId,
      userId,
      action: AuditAction.TASK_UPDATE,
      resourceType: 'task',
      resourceId: req.params.id,
      details: { newStatus: 'cancelled' },
      req,
    });

    res.json({ success: true, data: { id: req.params.id } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
