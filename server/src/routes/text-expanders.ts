import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Zod Schemas ──

const expanderSchema = z.object({
  shortcut: z.string().min(1).max(50),
  expansion: z.string().min(1).max(10000),
  category: z.string().max(100).optional().nullable(),
  isShared: z.boolean().optional().default(false),
});

// ── List expanders for current user (own + shared) ──
router.get('/', requirePermission(Permission.TEXT_EXPANDER_VIEW), async (req: Request, res: Response) => {
  try {
    const { category } = req.query;

    let whereClause = 'te.clinic_id = $1 AND (te.user_id = $2 OR te.is_shared = true)';
    const params: unknown[] = [req.auth!.clinicId, req.auth!.userId];

    if (category) {
      whereClause += ` AND te.category = $${params.length + 1}`;
      params.push(category);
    }

    const result = await query(
      `SELECT te.id, te.shortcut, te.expansion, te.category, te.is_shared,
              te.user_id, te.created_at, te.updated_at,
              u.first_name as owner_first_name, u.last_name as owner_last_name
       FROM text_expanders te
       LEFT JOIN users u ON te.user_id = u.id
       WHERE ${whereClause}
       ORDER BY te.shortcut`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Get single expander ──
router.get('/:id', requirePermission(Permission.TEXT_EXPANDER_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT te.*, u.first_name as owner_first_name, u.last_name as owner_last_name
       FROM text_expanders te
       LEFT JOIN users u ON te.user_id = u.id
       WHERE te.id = $1 AND te.clinic_id = $2
         AND (te.user_id = $3 OR te.is_shared = true)`,
      [req.params.id, req.auth!.clinicId, req.auth!.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Text expander not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Create expander ──
router.post('/', requirePermission(Permission.TEXT_EXPANDER_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = expanderSchema.parse(req.body);

    // Check for duplicate shortcut within user's scope (own + shared in clinic)
    const duplicateCheck = await query(
      `SELECT id FROM text_expanders
       WHERE clinic_id = $1 AND shortcut = $2
         AND (user_id = $3 OR is_shared = true)`,
      [req.auth!.clinicId, input.shortcut, req.auth!.userId]
    );

    if (duplicateCheck.rows.length > 0) {
      res.status(409).json({
        success: false,
        error: `Shortcut "${input.shortcut}" already exists`,
      });
      return;
    }

    const result = await query(
      `INSERT INTO text_expanders (clinic_id, user_id, shortcut, expansion, category, is_shared)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        req.auth!.clinicId,
        req.auth!.userId,
        input.shortcut,
        input.expansion,
        input.category || null,
        input.isShared,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.SETTINGS_CHANGE,
      resourceType: 'text_expander',
      resourceId: result.rows[0].id,
      details: { action: 'create', shortcut: input.shortcut, isShared: input.isShared },
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

// ── Update expander (own, or shared if admin) ──
router.put('/:id', requirePermission(Permission.TEXT_EXPANDER_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = expanderSchema.partial().parse(req.body);

    // Verify the expander exists and user has rights to edit it
    const existing = await query(
      `SELECT id, user_id, is_shared FROM text_expanders
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Text expander not found' });
      return;
    }

    const expander = existing.rows[0];
    const isOwner = expander.user_id === req.auth!.userId;
    const isAdmin = req.auth!.role === 'admin' || req.auth!.role === 'owner' || req.auth!.role === 'dev';

    // Can only edit own expanders, or shared expanders if admin
    if (!isOwner && !(expander.is_shared && isAdmin)) {
      res.status(403).json({ success: false, error: 'Cannot edit another user\'s text expander' });
      return;
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      shortcut: 'shortcut',
      expansion: 'expansion',
      category: 'category',
      isShared: 'is_shared',
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

    // If shortcut is being changed, check for duplicates
    if (input.shortcut) {
      const duplicateCheck = await query(
        `SELECT id FROM text_expanders
         WHERE clinic_id = $1 AND shortcut = $2 AND id != $3
           AND (user_id = $4 OR is_shared = true)`,
        [req.auth!.clinicId, input.shortcut, req.params.id, req.auth!.userId]
      );

      if (duplicateCheck.rows.length > 0) {
        res.status(409).json({
          success: false,
          error: `Shortcut "${input.shortcut}" already exists`,
        });
        return;
      }
    }

    const result = await query(
      `UPDATE text_expanders SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Text expander not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.SETTINGS_CHANGE,
      resourceType: 'text_expander',
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

// ── Delete expander ──
router.delete('/:id', requirePermission(Permission.TEXT_EXPANDER_MANAGE), async (req: Request, res: Response) => {
  try {
    // Verify the expander exists and user has rights to delete it
    const existing = await query(
      `SELECT id, user_id, is_shared, shortcut FROM text_expanders
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Text expander not found' });
      return;
    }

    const expander = existing.rows[0];
    const isOwner = expander.user_id === req.auth!.userId;
    const isAdmin = req.auth!.role === 'admin' || req.auth!.role === 'owner' || req.auth!.role === 'dev';

    if (!isOwner && !isAdmin) {
      res.status(403).json({ success: false, error: 'Cannot delete another user\'s text expander' });
      return;
    }

    await query(
      `DELETE FROM text_expanders WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.SETTINGS_CHANGE,
      resourceType: 'text_expander',
      resourceId: req.params.id,
      details: { action: 'delete', shortcut: expander.shortcut },
      req,
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Quick expand lookup ──
// Given a shortcut string, return the expansion text
router.post('/expand', requirePermission(Permission.TEXT_EXPANDER_VIEW), async (req: Request, res: Response) => {
  try {
    const { shortcut } = z.object({ shortcut: z.string().min(1) }).parse(req.body);

    const result = await query(
      `SELECT id, shortcut, expansion, category
       FROM text_expanders
       WHERE clinic_id = $1 AND shortcut = $2
         AND (user_id = $3 OR is_shared = true)
       LIMIT 1`,
      [req.auth!.clinicId, shortcut, req.auth!.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Shortcut not found' });
      return;
    }

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
