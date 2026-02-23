import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';
import { config } from '../config';

const router = Router();

// ────────────────────────────────────────────────────────────────────────────
// Portal JWT helpers — separate token namespace from staff JWTs
// ────────────────────────────────────────────────────────────────────────────

interface PortalJWTPayload {
  portalUserId: string;
  patientId: string;
  clinicId: string;
  type: 'portal';
}

function signPortalToken(payload: PortalJWTPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: '4h' });
}

function verifyPortalToken(token: string): PortalJWTPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET) as PortalJWTPayload;
  if (decoded.type !== 'portal') {
    throw new Error('Invalid token type');
  }
  return decoded;
}

// ────────────────────────────────────────────────────────────────────────────
// Patient-side auth middleware — validates portal JWT, attaches portal context
// ────────────────────────────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      portal?: PortalJWTPayload;
    }
  }
}

function authenticatePortalUser(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const payload = verifyPortalToken(token);
    req.portal = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ success: false, error: 'Token expired' });
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

/**
 * Ensure the portal user account is still active before servicing any request.
 */
async function requireActivePortalUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.portal) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  try {
    const result = await query(
      `SELECT id, is_active FROM portal_users WHERE id = $1 AND clinic_id = $2`,
      [req.portal.portalUserId, req.portal.clinicId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      res.status(403).json({ success: false, error: 'Portal account is deactivated' });
      return;
    }

    next();
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ============================================================================
//  STAFF ENDPOINTS — standard clinic auth (authenticate + validateSession)
// ============================================================================

const staffRouter = Router();
staffRouter.use(authenticate, validateSession, tenantScope);

// ── POST /users — Create portal user account for a patient ──────────────────
const createPortalUserSchema = z.object({
  patientId: z.string().uuid(),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

staffRouter.post(
  '/users',
  requirePermission(Permission.PORTAL_MANAGE),
  async (req: Request, res: Response) => {
    try {
      const input = createPortalUserSchema.parse(req.body);
      const clinicId = req.auth!.clinicId;

      // Verify patient belongs to this clinic
      const patientResult = await query(
        `SELECT id, first_name, last_name FROM patients WHERE id = $1 AND clinic_id = $2`,
        [input.patientId, clinicId]
      );
      if (patientResult.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Patient not found' });
        return;
      }

      // Check for duplicate email within clinic
      const dupCheck = await query(
        `SELECT id FROM portal_users WHERE email = $1 AND clinic_id = $2`,
        [input.email.toLowerCase(), clinicId]
      );
      if (dupCheck.rows.length > 0) {
        res.status(409).json({ success: false, error: 'A portal account with this email already exists' });
        return;
      }

      // Check if patient already has a portal account
      const existingCheck = await query(
        `SELECT id FROM portal_users WHERE patient_id = $1 AND clinic_id = $2`,
        [input.patientId, clinicId]
      );
      if (existingCheck.rows.length > 0) {
        res.status(409).json({ success: false, error: 'This patient already has a portal account' });
        return;
      }

      const passwordHash = await bcrypt.hash(input.password, 12);
      const verificationToken = crypto.randomBytes(32).toString('hex');

      const result = await query(
        `INSERT INTO portal_users (clinic_id, patient_id, email, password_hash, verification_token, is_active, email_verified)
         VALUES ($1, $2, $3, $4, $5, true, false)
         RETURNING id, email, is_active, email_verified, created_at`,
        [clinicId, input.patientId, input.email.toLowerCase(), passwordHash, verificationToken]
      );

      await logAudit({
        clinicId,
        userId: req.auth!.userId,
        action: AuditAction.PORTAL_USER_CREATE,
        resourceType: 'portal_user',
        resourceId: result.rows[0].id,
        details: { patientId: input.patientId },
        req,
      });

      res.status(201).json({
        success: true,
        data: {
          ...result.rows[0],
          verificationToken,
          patientId: input.patientId,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// ── GET /users — List portal users for this clinic ──────────────────────────
staffRouter.get(
  '/users',
  requirePermission(Permission.PORTAL_MANAGE),
  async (req: Request, res: Response) => {
    try {
      const clinicId = req.auth!.clinicId;
      const { page = '1', limit = '25', search } = req.query;

      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));

      const conditions: string[] = ['pu.clinic_id = $1'];
      const params: unknown[] = [clinicId];
      let idx = 2;

      if (search) {
        conditions.push(
          `(pu.email ILIKE $${idx} OR p.first_name ILIKE $${idx} OR p.last_name ILIKE $${idx})`
        );
        params.push(`%${search}%`);
        idx++;
      }

      const where = conditions.join(' AND ');

      const countResult = await query(
        `SELECT COUNT(*) as total
         FROM portal_users pu
         JOIN patients p ON pu.patient_id = p.id
         WHERE ${where}`,
        params
      );

      const result = await query(
        `SELECT pu.id, pu.email, pu.is_active, pu.email_verified, pu.last_login, pu.created_at,
                p.id as patient_id, p.first_name, p.last_name, p.mrn, p.date_of_birth
         FROM portal_users pu
         JOIN patients p ON pu.patient_id = p.id
         WHERE ${where}
         ORDER BY pu.created_at DESC
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
  }
);

// ── PUT /users/:id/deactivate — Deactivate a portal user ───────────────────
staffRouter.put(
  '/users/:id/deactivate',
  requirePermission(Permission.PORTAL_MANAGE),
  async (req: Request, res: Response) => {
    try {
      const clinicId = req.auth!.clinicId;

      const result = await query(
        `UPDATE portal_users SET is_active = false, updated_at = NOW()
         WHERE id = $1 AND clinic_id = $2
         RETURNING id, email, is_active`,
        [req.params.id, clinicId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Portal user not found' });
        return;
      }

      await logAudit({
        clinicId,
        userId: req.auth!.userId,
        action: AuditAction.PORTAL_USER_CREATE, // re-use; closest available action
        resourceType: 'portal_user',
        resourceId: req.params.id,
        details: { action: 'deactivate' },
        req,
      });

      res.json({ success: true, data: result.rows[0] });
    } catch {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// ── GET /messages — List portal messages (staff view) ───────────────────────
staffRouter.get(
  '/messages',
  requirePermission(Permission.PORTAL_MANAGE),
  async (req: Request, res: Response) => {
    try {
      const clinicId = req.auth!.clinicId;
      const { patientId, direction, read, page = '1', limit = '25' } = req.query;

      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));

      const conditions: string[] = ['pm.clinic_id = $1'];
      const params: unknown[] = [clinicId];
      let idx = 2;

      if (patientId) {
        conditions.push(`pm.patient_id = $${idx++}`);
        params.push(patientId);
      }
      if (direction === 'inbound' || direction === 'outbound') {
        conditions.push(`pm.direction = $${idx++}`);
        params.push(direction);
      }
      if (read === 'true') {
        conditions.push(`pm.read_at IS NOT NULL`);
      } else if (read === 'false') {
        conditions.push(`pm.read_at IS NULL`);
      }

      const where = conditions.join(' AND ');

      const countResult = await query(
        `SELECT COUNT(*) as total FROM portal_messages pm WHERE ${where}`,
        params
      );

      const result = await query(
        `SELECT pm.*,
                p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
         FROM portal_messages pm
         JOIN patients p ON pm.patient_id = p.id
         WHERE ${where}
         ORDER BY pm.created_at DESC
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
  }
);

// ── POST /messages — Staff sends message to patient ─────────────────────────
const staffMessageSchema = z.object({
  patientId: z.string().uuid(),
  subject: z.string().min(1).max(255),
  body: z.string().min(1).max(10000),
});

staffRouter.post(
  '/messages',
  requirePermission(Permission.PORTAL_MANAGE),
  async (req: Request, res: Response) => {
    try {
      const input = staffMessageSchema.parse(req.body);
      const clinicId = req.auth!.clinicId;

      // Verify patient belongs to clinic
      const patientResult = await query(
        `SELECT id FROM patients WHERE id = $1 AND clinic_id = $2`,
        [input.patientId, clinicId]
      );
      if (patientResult.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Patient not found' });
        return;
      }

      const result = await query(
        `INSERT INTO portal_messages (clinic_id, patient_id, sender_type, sender_id, direction, subject, body)
         VALUES ($1, $2, 'staff', $3, 'outbound', $4, $5)
         RETURNING id, direction, subject, created_at`,
        [clinicId, input.patientId, req.auth!.userId, input.subject, input.body]
      );

      await logAudit({
        clinicId,
        userId: req.auth!.userId,
        action: AuditAction.PORTAL_MESSAGE_SEND,
        resourceType: 'portal_message',
        resourceId: result.rows[0].id,
        details: { patientId: input.patientId, direction: 'outbound' },
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
  }
);

// ── GET /messages/:id — Get single message; auto-mark inbound as read ──────
staffRouter.get(
  '/messages/:id',
  requirePermission(Permission.PORTAL_MANAGE),
  async (req: Request, res: Response) => {
    try {
      const clinicId = req.auth!.clinicId;

      const result = await query(
        `SELECT pm.*,
                p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
         FROM portal_messages pm
         JOIN patients p ON pm.patient_id = p.id
         WHERE pm.id = $1 AND pm.clinic_id = $2`,
        [req.params.id, clinicId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Message not found' });
        return;
      }

      const message = result.rows[0];

      // Auto-mark inbound messages as read when staff views them
      if (message.direction === 'inbound' && !message.read_at) {
        await query(
          `UPDATE portal_messages SET read_at = NOW(), read_by = $3
           WHERE id = $1 AND clinic_id = $2`,
          [req.params.id, clinicId, req.auth!.userId]
        );
        message.read_at = new Date().toISOString();
        message.read_by = req.auth!.userId;
      }

      res.json({ success: true, data: message });
    } catch {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// Mount all staff routes under the main router
router.use('/', staffRouter);

// ============================================================================
//  PATIENT ENDPOINTS — portal JWT auth (separate from staff auth)
// ============================================================================

const patientRouter = Router();
patientRouter.use(authenticatePortalUser, requireActivePortalUser);

// ── POST /patient/login — Portal user login ─────────────────────────────────
// NOTE: login does NOT go through patientRouter (no auth required)
router.post('/patient/login', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });
    const input = schema.parse(req.body);

    // Look up portal user by email — there is no clinic context on login,
    // so we match across all clinics. Each email+clinic pair is unique.
    // For multi-clinic setups the caller can also pass clinicId.
    const clinicIdFilter = req.body.clinicId;
    let userResult;

    if (clinicIdFilter) {
      userResult = await query(
        `SELECT pu.id, pu.clinic_id, pu.patient_id, pu.password_hash, pu.is_active, pu.email_verified
         FROM portal_users pu
         WHERE pu.email = $1 AND pu.clinic_id = $2`,
        [input.email.toLowerCase(), clinicIdFilter]
      );
    } else {
      userResult = await query(
        `SELECT pu.id, pu.clinic_id, pu.patient_id, pu.password_hash, pu.is_active, pu.email_verified
         FROM portal_users pu
         WHERE pu.email = $1`,
        [input.email.toLowerCase()]
      );
    }

    if (userResult.rows.length === 0) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    const portalUser = userResult.rows[0];

    if (!portalUser.is_active) {
      res.status(403).json({ success: false, error: 'Account is deactivated' });
      return;
    }

    const validPassword = await bcrypt.compare(input.password, portalUser.password_hash);
    if (!validPassword) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    // Update last login
    await query(
      `UPDATE portal_users SET last_login = NOW() WHERE id = $1`,
      [portalUser.id]
    );

    const tokenPayload: PortalJWTPayload = {
      portalUserId: portalUser.id,
      patientId: portalUser.patient_id,
      clinicId: portalUser.clinic_id,
      type: 'portal',
    };
    const token = signPortalToken(tokenPayload);

    res.json({
      success: true,
      data: {
        token,
        portalUserId: portalUser.id,
        patientId: portalUser.patient_id,
        clinicId: portalUser.clinic_id,
        emailVerified: portalUser.email_verified,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /patient/profile — Limited patient demographics ─────────────────────
patientRouter.get('/profile', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;

    const result = await query(
      `SELECT p.id, p.first_name, p.last_name, p.date_of_birth, p.gender,
              p.email, p.phone,
              p.address_line1, p.address_line2, p.city, p.state, p.zip,
              p.emergency_contact_name, p.emergency_contact_phone,
              pu.email as portal_email, pu.email_verified
       FROM patients p
       JOIN portal_users pu ON pu.patient_id = p.id AND pu.clinic_id = p.clinic_id
       WHERE p.id = $1 AND p.clinic_id = $2 AND pu.id = $3`,
      [patientId, clinicId, req.portal!.portalUserId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /patient/appointments — Upcoming appointments ───────────────────────
patientRouter.get('/appointments', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    const { page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));

    const countResult = await query(
      `SELECT COUNT(*) as total
       FROM appointments
       WHERE patient_id = $1 AND clinic_id = $2
         AND start_time >= NOW()
         AND status NOT IN ('cancelled')`,
      [patientId, clinicId]
    );

    const result = await query(
      `SELECT a.id, a.start_time, a.end_time, a.appointment_type, a.status, a.notes,
              u.first_name as therapist_first_name, u.last_name as therapist_last_name,
              u.credential as therapist_credential
       FROM appointments a
       JOIN users u ON a.therapist_id = u.id
       WHERE a.patient_id = $1 AND a.clinic_id = $2
         AND a.start_time >= NOW()
         AND a.status NOT IN ('cancelled')
       ORDER BY a.start_time ASC
       LIMIT $3 OFFSET $4`,
      [patientId, clinicId, limitNum, (pageNum - 1) * limitNum]
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

// ── GET /patient/messages — Messages for this patient ───────────────────────
patientRouter.get('/messages', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    const { page = '1', limit = '25' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));

    const countResult = await query(
      `SELECT COUNT(*) as total FROM portal_messages WHERE patient_id = $1 AND clinic_id = $2`,
      [patientId, clinicId]
    );

    const result = await query(
      `SELECT id, direction, subject, body, created_at, read_at
       FROM portal_messages
       WHERE patient_id = $1 AND clinic_id = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [patientId, clinicId, limitNum, (pageNum - 1) * limitNum]
    );

    // Auto-mark outbound (staff-to-patient) messages as read when patient fetches them
    const unreadOutboundIds = result.rows
      .filter((m: any) => m.direction === 'outbound' && !m.read_at)
      .map((m: any) => m.id);

    if (unreadOutboundIds.length > 0) {
      await query(
        `UPDATE portal_messages SET read_at = NOW()
         WHERE id = ANY($1) AND clinic_id = $2 AND read_at IS NULL`,
        [unreadOutboundIds, clinicId]
      );
    }

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

// ── POST /patient/messages — Patient sends message to clinic ────────────────
const patientMessageSchema = z.object({
  subject: z.string().min(1).max(255),
  body: z.string().min(1).max(10000),
});

patientRouter.post('/messages', async (req: Request, res: Response) => {
  try {
    const input = patientMessageSchema.parse(req.body);
    const { patientId, clinicId, portalUserId } = req.portal!;

    const result = await query(
      `INSERT INTO portal_messages (clinic_id, patient_id, sender_type, sender_id, direction, subject, body)
       VALUES ($1, $2, 'patient', $3, 'inbound', $4, $5)
       RETURNING id, direction, subject, created_at`,
      [clinicId, patientId, portalUserId, input.subject, input.body]
    );

    await logAudit({
      clinicId,
      userId: null,
      action: AuditAction.PORTAL_MESSAGE_SEND,
      resourceType: 'portal_message',
      resourceId: result.rows[0].id,
      details: { patientId, direction: 'inbound', portalUserId },
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

// ── GET /patient/documents — Non-clinical attachments for this patient ──────
patientRouter.get('/documents', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    const { page = '1', limit = '25' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));

    // Only return attachments that are NOT linked to a clinical note (non-clinical)
    const countResult = await query(
      `SELECT COUNT(*) as total
       FROM attachments
       WHERE patient_id = $1 AND clinic_id = $2 AND note_id IS NULL AND scan_status = 'clean'`,
      [patientId, clinicId]
    );

    const result = await query(
      `SELECT id, original_filename, mime_type, size_bytes, created_at
       FROM attachments
       WHERE patient_id = $1 AND clinic_id = $2 AND note_id IS NULL AND scan_status = 'clean'
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [patientId, clinicId, limitNum, (pageNum - 1) * limitNum]
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

// ── GET /patient/billing — Ledger summary (charges, payments, balance) ──────
patientRouter.get('/billing', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;

    // Summary aggregates
    const summaryResult = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'charge' THEN amount_cents ELSE 0 END), 0) as total_charges_cents,
         COALESCE(SUM(CASE WHEN entry_type = 'payment' THEN amount_cents ELSE 0 END), 0) as total_payments_cents,
         COALESCE(SUM(CASE WHEN entry_type = 'adjustment' THEN amount_cents ELSE 0 END), 0) as total_adjustments_cents,
         COALESCE(SUM(CASE WHEN entry_type = 'refund' THEN amount_cents ELSE 0 END), 0) as total_refunds_cents,
         COALESCE(SUM(CASE WHEN entry_type = 'write_off' THEN amount_cents ELSE 0 END), 0) as total_write_offs_cents
       FROM ledger_entries
       WHERE patient_id = $1 AND clinic_id = $2`,
      [patientId, clinicId]
    );

    const summary = summaryResult.rows[0];
    const totalChargesCents = parseInt(summary.total_charges_cents, 10);
    const totalPaymentsCents = parseInt(summary.total_payments_cents, 10);
    const totalAdjustmentsCents = parseInt(summary.total_adjustments_cents, 10);
    const totalRefundsCents = parseInt(summary.total_refunds_cents, 10);
    const totalWriteOffsCents = parseInt(summary.total_write_offs_cents, 10);

    const balanceCents =
      totalChargesCents
      - totalPaymentsCents
      - totalAdjustmentsCents
      + totalRefundsCents
      - totalWriteOffsCents;

    // Recent ledger entries (limited info — no internal claim IDs)
    const entriesResult = await query(
      `SELECT id, entry_type, amount_cents, description, service_date, posted_at
       FROM ledger_entries
       WHERE patient_id = $1 AND clinic_id = $2
       ORDER BY posted_at DESC
       LIMIT 50`,
      [patientId, clinicId]
    );

    res.json({
      success: true,
      data: {
        summary: {
          totalChargesCents,
          totalPaymentsCents,
          totalAdjustmentsCents,
          totalRefundsCents,
          totalWriteOffsCents,
          balanceCents,
        },
        recentEntries: entriesResult.rows,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Mount patient routes
router.use('/patient', patientRouter);

export default router;
