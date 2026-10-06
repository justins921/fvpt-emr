import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { query, pool } from '../db';
import { AuditAction } from '../types';
import { hashPassword, createSession, buildUserResponse } from '../services/auth';
import { setRefreshCookie } from './auth';
import { logAudit } from '../services/audit';

const router = Router();

// Modest brute-force protection on the accept endpoint: 10 attempts per
// token per hour. The token itself is 256 bits of entropy, so this is just
// defense in depth.
const acceptLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${req.params.token || 'x'}:${req.ip || 'unknown'}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts. Try again later.' },
});

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

interface InviteRow {
  id: string;
  clinic_id: string;
  email: string;
  role: string;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  clinic_name: string;
}

async function findValidInvite(token: string): Promise<{ invite: InviteRow | null; error: string | null }> {
  if (!token || typeof token !== 'string' || token.length > 256) {
    return { invite: null, error: 'This invite link is invalid.' };
  }
  const result = await query(
    `SELECT i.id, i.clinic_id, i.email, i.role, i.invited_by, i.expires_at,
            i.accepted_at, i.revoked_at, c.name AS clinic_name
     FROM user_invites i
     JOIN clinics c ON c.id = i.clinic_id
     WHERE i.token_hash = $1`,
    [hashToken(token)]
  );
  if (result.rows.length === 0) {
    return { invite: null, error: 'This invite link is invalid.' };
  }
  const invite = result.rows[0] as InviteRow;
  if (invite.accepted_at) {
    return { invite: null, error: 'This invite has already been used.' };
  }
  if (invite.revoked_at) {
    return { invite: null, error: 'This invite has been revoked. Ask your administrator for a new one.' };
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return { invite: null, error: 'This invite has expired. Ask your administrator for a new one.' };
  }
  return { invite, error: null };
}

// Public: validate an invite token (for the accept page)
router.get('/:token/validate', async (req: Request, res: Response) => {
  try {
    const { invite, error } = await findValidInvite(req.params.token);
    if (error || !invite) {
      res.status(404).json({ success: false, error: error || 'This invite link is invalid.' });
      return;
    }
    res.json({
      success: true,
      data: {
        email: invite.email,
        role: invite.role,
        clinicName: invite.clinic_name,
        expiresAt: invite.expires_at,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const acceptSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(100),
  lastName: z.string().trim().min(1, 'Last name is required.').max(100),
  password: z.string().min(12, 'Password must be at least 12 characters.').max(128),
});

// Public: accept an invite — creates the user and signs them in
router.post('/:token/accept', acceptLimiter, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const input = acceptSchema.parse(req.body);
    const tokenHash = hashToken(req.params.token || '');

    await client.query('BEGIN');
    const found = await client.query(
      `SELECT i.id, i.clinic_id, i.email, i.role, i.invited_by, i.expires_at,
              i.accepted_at, i.revoked_at, c.name AS clinic_name
       FROM user_invites i
       JOIN clinics c ON c.id = i.clinic_id
       WHERE i.token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ success: false, error: 'This invite link is invalid.' });
      return;
    }
    const invite = found.rows[0] as InviteRow;
    if (invite.accepted_at || invite.revoked_at || new Date(invite.expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      res.status(410).json({
        success: false,
        error: invite.accepted_at
          ? 'This invite has already been used.'
          : 'This invite is no longer valid. Ask your administrator for a new one.',
      });
      return;
    }

    // The invite email becomes the username (unique per clinic)
    const passwordHash = await hashPassword(input.password);
    let userId: string;
    try {
      const created = await client.query(
        `INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [invite.clinic_id, invite.email, passwordHash, input.firstName, input.lastName, invite.role]
      );
      userId = created.rows[0].id;
    } catch (err) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        await client.query('ROLLBACK');
        res.status(409).json({
          success: false,
          error: 'An account with this email already exists in this clinic. Try signing in instead.',
        });
        return;
      }
      throw err;
    }

    await client.query(`UPDATE user_invites SET accepted_at = NOW() WHERE id = $1`, [invite.id]);
    await client.query('COMMIT');

    const userResult = await query(
      `SELECT id, clinic_id, username, first_name, last_name, role, npi
       FROM users WHERE id = $1`,
      [userId]
    );
    const userRow = userResult.rows[0];
    const { accessToken, refreshToken } = await createSession(userRow, req);
    setRefreshCookie(res, refreshToken);

    await logAudit({
      clinicId: invite.clinic_id,
      userId,
      action: AuditAction.USER_INVITE_ACCEPT,
      resourceType: 'user_invite',
      resourceId: invite.id,
      details: { role: invite.role },
      req,
    });

    res.status(201).json({
      success: true,
      data: { accessToken, user: buildUserResponse(userRow) },
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      res.status(400).json({
        success: false,
        error: first ? `${String(first.path[0] || 'Field')}: ${first.message}` : 'Invalid input.',
      });
      return;
    }
    console.error('[INVITE ACCEPT ERROR]', err instanceof Error ? err.message : err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;
