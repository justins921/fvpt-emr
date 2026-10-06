import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction, Role } from '../types';
import { hashPassword } from '../services/auth';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

const VALID_CREDENTIALS = ['PT', 'DPT', 'PTA', 'ATC', 'OT', 'SLP', 'MD', 'DO', 'NP', 'PA', 'Office'] as const;

const createUserSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.nativeEnum(Role),
  credential: z.enum(VALID_CREDENTIALS).optional().nullable(),
  npi: z.string().max(10).optional(),
  licenseNumber: z.string().max(50).optional(),
});

// List users
router.get('/', requirePermission(Permission.USER_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, username, first_name, last_name, role, credential, npi, license_number, is_active, last_login, created_at
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
      `INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi, license_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [req.auth!.clinicId, input.username, passwordHash, input.firstName, input.lastName, input.role, input.credential || null, input.npi || null, input.licenseNumber || null]
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
      res.status(409).json({ success: false, error: 'Username already exists in this clinic' });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Roles reference for the admin UI (no migration needed — derived from ROLE_PERMISSIONS)
// NOTE: must be registered before GET /:id so "roles" isn't captured as an id
router.get('/roles', requirePermission(Permission.USER_VIEW), async (req: Request, res: Response) => {
  try {
    const { ROLE_PERMISSIONS } = await import('../types');
    const data = (Object.keys(ROLE_PERMISSIONS) as Role[]).map((role) => ({
      role,
      permissions: ROLE_PERMISSIONS[role],
    }));
    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get single user
router.get('/:id', requirePermission(Permission.USER_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, username, first_name, last_name, role, credential, npi, license_number, is_active, mfa_enabled, last_login, created_at
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

// Roles that can fully administer the clinic — at least one active one must always exist
const PRIVILEGED_ROLES = [Role.OWNER, Role.ADMIN];

// Update user
router.put('/:id', requirePermission(Permission.USER_EDIT), async (req: Request, res: Response) => {
  try {
    const updateSchema = z.object({
      firstName: z.string().min(1).max(100).optional(),
      lastName: z.string().min(1).max(100).optional(),
      role: z.nativeEnum(Role).optional(),
      credential: z.enum(VALID_CREDENTIALS).optional().nullable(),
      npi: z.string().max(10).optional(),
      licenseNumber: z.string().max(50).optional(),
      isActive: z.boolean().optional(),
    });
    const input = updateSchema.parse(req.body);
    const { firstName, lastName, role, credential, npi, licenseNumber, isActive } = input;

    // Guard 1: nobody can change their own role (prevents self-lockout)
    if (role && req.params.id === req.auth!.userId) {
      res.status(403).json({ success: false, error: 'You cannot change your own role. Ask another administrator.' });
      return;
    }

    // Guard 2: only owners can grant owner/admin roles
    if (role && PRIVILEGED_ROLES.includes(role) && req.auth!.role !== Role.OWNER) {
      res.status(403).json({ success: false, error: 'Only owners can grant owner or admin roles' });
      return;
    }

    if (role) {
      // Look up the target's current role
      const target = await query(
        `SELECT role, is_active FROM users WHERE id = $1 AND clinic_id = $2`,
        [req.params.id, req.auth!.clinicId]
      );
      if (target.rows.length === 0) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      const currentRole = target.rows[0].role as Role;
      // Guard 3: never demote the last remaining owner/admin
      if (PRIVILEGED_ROLES.includes(currentRole) && !PRIVILEGED_ROLES.includes(role) && target.rows[0].is_active) {
        const remaining = await query(
          `SELECT COUNT(*)::int AS n FROM users
           WHERE clinic_id = $1 AND role IN ('owner','admin') AND is_active = true AND id <> $2`,
          [req.auth!.clinicId, req.params.id]
        );
        if (remaining.rows[0].n === 0) {
          res.status(403).json({
            success: false,
            error: 'Cannot demote the last remaining owner/admin. Promote another user first.',
          });
          return;
        }
      }
    }

    const result = await query(
      `UPDATE users SET
        first_name = COALESCE($3, first_name),
        last_name = COALESCE($4, last_name),
        role = COALESCE($5, role),
        credential = COALESCE($6, credential),
        npi = COALESCE($7, npi),
        license_number = COALESCE($8, license_number),
        is_active = COALESCE($9, is_active)
       WHERE id = $1 AND clinic_id = $2
       RETURNING id, username, first_name, last_name, role, credential, is_active`,
      [req.params.id, req.auth!.clinicId, firstName, lastName, role, credential, npi, licenseNumber, isActive]
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
      details: role ? { roleChangedTo: role } : undefined,
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
