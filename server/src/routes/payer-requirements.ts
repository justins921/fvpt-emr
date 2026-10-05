import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

const requiredFieldEnum = z.enum([
  'eval_note',
  'plan_of_care',
  'diagnosis_codes',
  'clinical_justification',
]);

const createSchema = z.object({
  payer_name: z.string().min(1).max(255),
  requires_auth_for_pt: z.boolean().optional().default(true),
  typical_visit_limit: z.number().int().positive().optional().nullable(),
  required_fields: z.array(requiredFieldEnum).optional().default([]),
  submission_notes: z.string().max(4000).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  portal_url: z.string().max(2000).url().optional().nullable(),
});

const updateSchema = createSchema
  .omit({ payer_name: true })
  .partial()
  .extend({ payer_name: z.string().min(1).max(255).optional() });

// ── List Payer Requirements ──
router.get('/', requirePermission(Permission.AUTHORIZATION_VIEW), async (req: Request, res: Response) => {
  try {
    const { search, page = '1', limit = '25' } = req.query;
    const conditions: string[] = ['clinic_id = $1'];
    const params: unknown[] = [req.auth!.clinicId];
    let idx = 2;

    if (search) {
      conditions.push(`payer_name ILIKE $${idx++}`);
      params.push(`%${search}%`);
    }

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, parseInt(limit as string, 10));
    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) as total FROM payer_auth_requirements WHERE ${where}`,
      params
    );

    const result = await query(
      `SELECT *
       FROM payer_auth_requirements
       WHERE ${where}
       ORDER BY payer_name ASC
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

// ── Get Single Payer Requirement ──
router.get('/:id', requirePermission(Permission.AUTHORIZATION_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM payer_auth_requirements WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Payer requirement not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Create Payer Requirement ──
router.post('/', requirePermission(Permission.AUTHORIZATION_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = createSchema.parse(req.body);

    const result = await query(
      `INSERT INTO payer_auth_requirements
         (clinic_id, payer_name, requires_auth_for_pt, typical_visit_limit, required_fields, submission_notes, phone, portal_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (clinic_id, payer_name) DO NOTHING
       RETURNING id`,
      [
        req.auth!.clinicId,
        input.payer_name,
        input.requires_auth_for_pt,
        input.typical_visit_limit ?? null,
        JSON.stringify(input.required_fields),
        input.submission_notes ?? null,
        input.phone ?? null,
        input.portal_url ?? null,
      ]
    );

    if (result.rows.length === 0) {
      res.status(409).json({ success: false, error: 'A requirement for this payer already exists' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.AUTHORIZATION_CREATE,
      resourceType: 'payer_auth_requirement',
      resourceId: result.rows[0].id,
      details: {
        payer_name: input.payer_name,
        requires_auth_for_pt: input.requires_auth_for_pt,
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

// ── Update Payer Requirement ──
router.put('/:id', requirePermission(Permission.AUTHORIZATION_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = updateSchema.parse(req.body);

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      payer_name: 'payer_name',
      requires_auth_for_pt: 'requires_auth_for_pt',
      typical_visit_limit: 'typical_visit_limit',
      required_fields: 'required_fields',
      submission_notes: 'submission_notes',
      phone: 'phone',
      portal_url: 'portal_url',
    };

    for (const [key, value] of Object.entries(input)) {
      if (fieldMap[key]) {
        fields.push(`${fieldMap[key]} = $${idx++}`);
        values.push(key === 'required_fields' ? JSON.stringify(value) : (value ?? null));
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    fields.push(`updated_at = NOW()`);

    const result = await query(
      `UPDATE payer_auth_requirements SET ${fields.join(', ')}
       WHERE id = $1 AND clinic_id = $2
       RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Payer requirement not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.AUTHORIZATION_EDIT,
      resourceType: 'payer_auth_requirement',
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

// ── Delete Payer Requirement ──
router.delete('/:id', requirePermission(Permission.AUTHORIZATION_MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM payer_auth_requirements
       WHERE id = $1 AND clinic_id = $2
       RETURNING id, payer_name`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Payer requirement not found' });
      return;
    }

    // No AUTHORIZATION_DELETE audit action exists; use AUTHORIZATION_EDIT
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.AUTHORIZATION_EDIT,
      resourceType: 'payer_auth_requirement',
      resourceId: req.params.id,
      details: { action: 'delete', payer_name: result.rows[0].payer_name },
      req,
    });

    res.json({ success: true, data: { id: req.params.id } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
