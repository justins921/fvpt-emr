import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction, NoteType } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Zod Schemas ──

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  noteType: z.nativeEnum(NoteType),
  subjectiveTemplate: z.string().max(10000).optional().nullable(),
  objectiveTemplate: z.string().max(10000).optional().nullable(),
  assessmentTemplate: z.string().max(10000).optional().nullable(),
  planTemplate: z.string().max(10000).optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

// ── List templates (optionally filtered by note type) ──
router.get('/', requirePermission(Permission.NOTE_TEMPLATE_VIEW), async (req: Request, res: Response) => {
  try {
    const noteType = typeof req.query.noteType === 'string' ? req.query.noteType : undefined;
    const includeInactive = req.query.includeInactive === 'true';

    let sql = `
      SELECT nt.*, u.first_name as creator_first_name, u.last_name as creator_last_name
      FROM note_templates nt
      LEFT JOIN users u ON nt.created_by = u.id
      WHERE nt.clinic_id = $1`;
    const params: unknown[] = [req.auth!.clinicId];

    if (noteType) {
      sql += ` AND nt.note_type = $${params.length + 1}`;
      params.push(noteType);
    }
    if (!includeInactive) {
      sql += ` AND nt.is_active = true`;
    }
    sql += ` ORDER BY nt.note_type, nt.name`;

    const result = await query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Get single template ──
router.get('/:id', requirePermission(Permission.NOTE_TEMPLATE_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT nt.*, u.first_name as creator_first_name, u.last_name as creator_last_name
       FROM note_templates nt
       LEFT JOIN users u ON nt.created_by = u.id
       WHERE nt.id = $1 AND nt.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Note template not found' });
      return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Create template ──
router.post('/', requirePermission(Permission.NOTE_TEMPLATE_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = templateSchema.parse(req.body);

    const result = await query(
      `INSERT INTO note_templates (
        clinic_id, name, note_type, subjective_template, objective_template,
        assessment_template, plan_template, is_active, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id`,
      [
        req.auth!.clinicId,
        input.name,
        input.noteType,
        input.subjectiveTemplate || null,
        input.objectiveTemplate || null,
        input.assessmentTemplate || null,
        input.planTemplate || null,
        input.isActive,
        req.auth!.userId,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.SETTINGS_CHANGE,
      resourceType: 'note_template',
      resourceId: result.rows[0].id,
      details: { action: 'create', name: input.name, noteType: input.noteType },
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

// ── Update template ──
router.put('/:id', requirePermission(Permission.NOTE_TEMPLATE_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = templateSchema.partial().parse(req.body);

    const existing = await query(
      `SELECT id FROM note_templates WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Note template not found' });
      return;
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      name: 'name',
      noteType: 'note_type',
      subjectiveTemplate: 'subjective_template',
      objectiveTemplate: 'objective_template',
      assessmentTemplate: 'assessment_template',
      planTemplate: 'plan_template',
      isActive: 'is_active',
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

    await query(
      `UPDATE note_templates SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.SETTINGS_CHANGE,
      resourceType: 'note_template',
      resourceId: req.params.id,
      details: { action: 'update', updatedFields: Object.keys(input) },
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

// ── Delete template ──
router.delete('/:id', requirePermission(Permission.NOTE_TEMPLATE_MANAGE), async (req: Request, res: Response) => {
  try {
    const existing = await query(
      `SELECT id, name FROM note_templates WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Note template not found' });
      return;
    }

    await query(`DELETE FROM note_templates WHERE id = $1 AND clinic_id = $2`, [
      req.params.id,
      req.auth!.clinicId,
    ]);

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.SETTINGS_CHANGE,
      resourceType: 'note_template',
      resourceId: req.params.id,
      details: { action: 'delete', name: existing.rows[0].name },
      req,
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
