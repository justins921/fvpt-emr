import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

const referringProviderSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  npi: z.string().length(10),
  specialty: z.string().max(200).optional().nullable(),
  organization: z.string().max(200).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  fax: z.string().max(20).optional().nullable(),
  email: z.string().email().optional().nullable(),
  addressLine1: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(2).optional().nullable(),
  zip: z.string().max(10).optional().nullable(),
  autoFaxEval: z.boolean().optional().default(false),
  autoFaxProgress: z.boolean().optional().default(false),
});

// ── List Referring Providers ──
// Supports search by name or NPI and pagination.
router.get('/', requirePermission(Permission.REFERRING_PROVIDER_VIEW), async (req: Request, res: Response) => {
  try {
    const { search, page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'clinic_id = $1 AND is_active = true';
    const params: unknown[] = [req.auth!.clinicId];

    if (search) {
      whereClause += ` AND (
        LOWER(first_name) LIKE LOWER($2) OR
        LOWER(last_name) LIKE LOWER($2) OR
        npi LIKE $2
      )`;
      params.push(`%${search}%`);
    }

    const countResult = await query(
      `SELECT COUNT(*) as total FROM referring_providers WHERE ${whereClause}`,
      params
    );

    const result = await query(
      `SELECT id, first_name, last_name, npi, specialty, organization, phone, fax, email,
              address_line1, city, state, zip, auto_fax_eval, auto_fax_progress, created_at
       FROM referring_providers
       WHERE ${whereClause}
       ORDER BY last_name, first_name
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
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

// ── Get Single Referring Provider ──
router.get('/:id', requirePermission(Permission.REFERRING_PROVIDER_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM referring_providers WHERE id = $1 AND clinic_id = $2 AND is_active = true`,
      [req.params.id, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Referring provider not found' });
      return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Create Referring Provider ──
router.post('/', requirePermission(Permission.REFERRING_PROVIDER_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = referringProviderSchema.parse(req.body);

    const result = await query(
      `INSERT INTO referring_providers (
        clinic_id, first_name, last_name, npi, specialty, organization,
        phone, fax, email, address_line1, city, state, zip,
        auto_fax_eval, auto_fax_progress
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id`,
      [
        req.auth!.clinicId, input.firstName, input.lastName, input.npi,
        input.specialty || null, input.organization || null,
        input.phone || null, input.fax || null, input.email || null,
        input.addressLine1 || null, input.city || null,
        input.state || null, input.zip || null,
        input.autoFaxEval, input.autoFaxProgress,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.REFERRING_PROVIDER_CREATE,
      resourceType: 'referring_provider',
      resourceId: result.rows[0].id,
      details: { npi: input.npi },
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

// ── Update Referring Provider ──
router.put('/:id', requirePermission(Permission.REFERRING_PROVIDER_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = referringProviderSchema.partial().parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      firstName: 'first_name',
      lastName: 'last_name',
      npi: 'npi',
      specialty: 'specialty',
      organization: 'organization',
      phone: 'phone',
      fax: 'fax',
      email: 'email',
      addressLine1: 'address_line1',
      city: 'city',
      state: 'state',
      zip: 'zip',
      autoFaxEval: 'auto_fax_eval',
      autoFaxProgress: 'auto_fax_progress',
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
      `UPDATE referring_providers SET ${fields.join(', ')}
       WHERE id = $1 AND clinic_id = $2 AND is_active = true
       RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Referring provider not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.REFERRING_PROVIDER_EDIT,
      resourceType: 'referring_provider',
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

// ── Soft Delete Referring Provider ──
router.delete('/:id', requirePermission(Permission.REFERRING_PROVIDER_MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE referring_providers SET is_active = false
       WHERE id = $1 AND clinic_id = $2 AND is_active = true
       RETURNING id`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Referring provider not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.REFERRING_PROVIDER_EDIT,
      resourceType: 'referring_provider',
      resourceId: req.params.id,
      details: { action: 'soft_delete' },
      req,
    });

    res.json({ success: true, data: { id: req.params.id } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
