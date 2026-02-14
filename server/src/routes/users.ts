import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction, Role } from '../types';
import { hashPassword } from '../services/auth';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.nativeEnum(Role),
  npi: z.string().max(10).optional(),
  licenseNumber: z.string().max(50).optional(),
});

// List users
router.get('/', requirePermission(Permission.USER_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, email, first_name, last_name, role, npi, license_number, is_active, last_login, created_at
       FROM users WHERE clinic_id = $1 ORDER BY last_name, first_name`,
      [req.auth!.clinicId]
    );
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Create user
router.post('/', requirePermission(Permission.USER_CREATE), async (req: Request, res: Response) => {
  try {
    const input = createUserSchema.parse(req.body);
    // Only Owner can create Owner/Admin
    if ([Role.OWNER, Role.ADMIN].includes(input.role) && req.auth!.role !== Role.OWNER) {
      res.status(403).json({ success: false, error: 'Only owners can create admin users' });
      return;
    }
    const passwordHash = await hashPassword(input.password);
    const result = await query(
      `INSERT INTO users (clinic_id, email, password_hash, first_name, last_name, role, npi, license_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.auth!.clinicId, input.email, passwordHash, input.firstName, input.lastName, input.role, input.npi || null, input.licenseNumber || null]
    );
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.USER_CREATE,
      resourceType: 'user',
      resourceId: result.rows[0].id,
      details: { role: input.role },
      req,
    });
    res.status(201).json({ success: true, data: { id: result.rows[0].id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') {
      res.status(409).json({ success: false, error: 'Email already exists in this clinic' });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get single user
router.get('/:id', requirePermission(Permission.USER_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, email, first_name, last_name, role, npi, license_number, is_active, mfa_enabled, last_login, created_at
       FROM users WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Update user
router.put('/:id', requirePermission(Permission.USER_EDIT), async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, role, npi, licenseNumber, isActive } = req.body;
    const result = await query(
      `UPDATE users SET
        first_name = COALESCE($3, first_name),
        last_name = COALESCE($4, last_name),
        role = COALESCE($5, role),
        npi = COALESCE($6, npi),
        license_number = COALESCE($7, license_number),
        is_active = COALESCE($8, is_active)
       WHERE id = $1 AND clinic_id = $2
       RETURNING id, email, first_name, last_name, role, is_active`,
      [req.params.id, req.auth!.clinicId, firstName, lastName, role, npi, licenseNumber, isActive]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.USER_EDIT,
      resourceType: 'user',
      resourceId: req.params.id,
      req,
    });
    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Deactivate user
router.post('/:id/deactivate', requirePermission(Permission.USER_DEACTIVATE), async (req: Request, res: Response) => {
  try {
    await query(
      `UPDATE users SET is_active = false WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    // Revoke all sessions
    await query(
      `UPDATE sessions SET revoked = true WHERE user_id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.USER_DEACTIVATE,
      resourceType: 'user',
      resourceId: req.params.id,
      req,
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
