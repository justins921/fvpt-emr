import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Schemas ──
const locationSchema = z.object({
  name: z.string().min(1).max(200),
  address_line1: z.string().min(1).max(200),
  address_line2: z.string().max(200).optional().nullable(),
  city: z.string().min(1).max(100),
  state: z.string().length(2),
  zip: z.string().min(5).max(10),
  phone: z.string().min(1).max(20),
  fax: z.string().max(20).optional().nullable(),
  npi: z.string().length(10).optional().nullable(),
  is_primary: z.boolean().optional().default(false),
  timezone: z.string().min(1).max(50).optional().default('America/New_York'),
  operating_hours: z.record(z.unknown()).optional().nullable(),
});

// ── List Locations ──
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM clinic_locations
       WHERE clinic_id = $1
       ORDER BY is_primary DESC, name ASC`,
      [req.auth!.clinicId]
    );

    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Get Single Location ──
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM clinic_locations
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Location not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Create Location ──
router.post('/', requirePermission(Permission.LOCATION_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = locationSchema.parse(req.body);

    // If this location is primary, unset any existing primary
    if (input.is_primary) {
      await query(
        `UPDATE clinic_locations SET is_primary = false WHERE clinic_id = $1 AND is_primary = true`,
        [req.auth!.clinicId]
      );
    }

    const result = await query(
      `INSERT INTO clinic_locations (clinic_id, name, address_line1, address_line2, city, state, zip, phone, fax, npi, is_primary, timezone, operating_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        req.auth!.clinicId,
        input.name,
        input.address_line1,
        input.address_line2 || null,
        input.city,
        input.state,
        input.zip,
        input.phone,
        input.fax || null,
        input.npi || null,
        input.is_primary,
        input.timezone,
        input.operating_hours ? JSON.stringify(input.operating_hours) : null,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.LOCATION_CREATE,
      resourceType: 'location',
      resourceId: result.rows[0].id,
      details: { name: input.name },
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

// ── Update Location ──
router.put('/:id', requirePermission(Permission.LOCATION_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = locationSchema.partial().parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      name: 'name',
      address_line1: 'address_line1',
      address_line2: 'address_line2',
      city: 'city',
      state: 'state',
      zip: 'zip',
      phone: 'phone',
      fax: 'fax',
      npi: 'npi',
      is_primary: 'is_primary',
      timezone: 'timezone',
    };

    for (const [key, value] of Object.entries(input)) {
      if (key === 'operating_hours') {
        fields.push(`operating_hours = $${idx++}`);
        values.push(value ? JSON.stringify(value) : null);
      } else if (fieldMap[key]) {
        fields.push(`${fieldMap[key]} = $${idx++}`);
        values.push(value ?? null);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    // If setting this as primary, unset the existing primary first
    if (input.is_primary) {
      await query(
        `UPDATE clinic_locations SET is_primary = false WHERE clinic_id = $1 AND is_primary = true AND id != $2`,
        [req.auth!.clinicId, req.params.id]
      );
    }

    fields.push(`updated_at = NOW()`);

    const result = await query(
      `UPDATE clinic_locations SET ${fields.join(', ')}
       WHERE id = $1 AND clinic_id = $2
       RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Location not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.LOCATION_EDIT,
      resourceType: 'location',
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

// ── Deactivate Location ──
router.put('/:id/deactivate', requirePermission(Permission.LOCATION_MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE clinic_locations SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING id`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Location not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.LOCATION_EDIT,
      resourceType: 'location',
      resourceId: req.params.id,
      details: { deactivated: true },
      req,
    });

    res.json({ success: true, data: { id: req.params.id, is_active: false } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
