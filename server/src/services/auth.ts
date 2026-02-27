import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { config } from '../config';
import { query, transaction } from '../db';
import { JWTPayload, Role, AuditAction } from '../types';
import { logAudit } from './audit';
import { verifyMfaToken } from './mfa';
import { Request } from 'express';

const BCRYPT_ROUNDS = 12;
const MFA_TOKEN_EXPIRY = '5m'; // Short-lived token for MFA challenge

// ── Types ──

export type LoginResult =
  | { mfaRequired: true; mfaToken: string; user: Record<string, unknown> }
  | { mfaRequired: false; accessToken: string; refreshToken: string; user: Record<string, unknown> };

interface MfaTokenPayload {
  userId: string;
  clinicId: string;
  purpose: 'mfa_challenge';
}

// ── Helpers ──

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload as object, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRY as string,
  } as jwt.SignOptions);
}

function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateMfaChallengeToken(userId: string, clinicId: string): string {
  const payload: MfaTokenPayload = { userId, clinicId, purpose: 'mfa_challenge' };
  return jwt.sign(payload as object, config.JWT_SECRET, {
    expiresIn: MFA_TOKEN_EXPIRY,
  } as jwt.SignOptions);
}

function verifyMfaChallengeToken(token: string): MfaTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as MfaTokenPayload;
    if (decoded.purpose !== 'mfa_challenge') return null;
    return decoded;
  } catch {
    return null;
  }
}

function buildUserResponse(user: Record<string, unknown>): Record<string, unknown> {
  return {
    id: user.id,
    clinicId: user.clinic_id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    role: user.role,
    npi: user.npi,
  };
}

/**
 * Enforce session concurrency limits. If the user has >= MAX_CONCURRENT_SESSIONS
 * active sessions, revoke the oldest one(s) until there is room for a new session.
 */
async function enforceSessionConcurrencyLimit(userId: string, clinicId: string): Promise<void> {
  const maxSessions = config.MAX_CONCURRENT_SESSIONS;

  const countResult = await query(
    `SELECT COUNT(*) AS active_count
     FROM sessions
     WHERE user_id = $1 AND clinic_id = $2 AND revoked = false AND expires_at > NOW()`,
    [userId, clinicId]
  );

  const activeCount = parseInt(countResult.rows[0].active_count, 10);

  if (activeCount >= maxSessions) {
    // Revoke the oldest sessions to make room for exactly one new session
    const sessionsToRevoke = activeCount - maxSessions + 1;

    await query(
      `UPDATE sessions SET revoked = true
       WHERE id IN (
         SELECT id FROM sessions
         WHERE user_id = $1 AND clinic_id = $2 AND revoked = false AND expires_at > NOW()
         ORDER BY created_at ASC
         LIMIT $3
       )`,
      [userId, clinicId, sessionsToRevoke]
    );
  }
}

/**
 * Create a new session for the user and return access + refresh tokens.
 * This is the shared session-creation logic used by both `login` (non-MFA)
 * and `completeMfaLogin`.
 */
async function createSession(
  user: Record<string, unknown>,
  req: Request
): Promise<{ accessToken: string; refreshToken: string }> {
  const userId = user.id as string;
  const clinicId = user.clinic_id as string;

  // Enforce concurrency limit before creating the new session
  await enforceSessionConcurrencyLimit(userId, clinicId);

  const sessionId = uuid();
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const absoluteTimeout = config.SESSION_ABSOLUTE_TIMEOUT_HOURS;

  await query(
    `INSERT INTO sessions (id, user_id, clinic_id, refresh_token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '${absoluteTimeout} hours')`,
    [
      sessionId,
      userId,
      clinicId,
      refreshTokenHash,
      req.ip || req.socket?.remoteAddress || 'unknown',
      req.headers['user-agent']?.substring(0, 500) || null,
    ]
  );

  // Update last login
  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [userId]);

  const payload: JWTPayload = {
    userId,
    clinicId,
    role: user.role as Role,
    sessionId,
  };

  const accessToken = generateAccessToken(payload);

  await logAudit({
    clinicId,
    userId,
    action: AuditAction.LOGIN,
    details: { sessionId },
    req,
  });

  return { accessToken, refreshToken };
}

// ── Public API ──

export async function login(
  username: string,
  password: string,
  req: Request
): Promise<LoginResult | null> {
  const result = await query(
    `SELECT id, clinic_id, username, password_hash, first_name, last_name, role, is_active, npi, mfa_enabled
     FROM users WHERE username = $1`,
    [username]
  );

  if (result.rows.length === 0) {
    await logAudit({
      clinicId: 'unknown',
      userId: null,
      action: AuditAction.LOGIN_FAILED,
      details: { reason: 'user_not_found' },
      req,
    });
    return null;
  }

  const user = result.rows[0];

  if (!user.is_active) {
    await logAudit({
      clinicId: user.clinic_id,
      userId: user.id,
      action: AuditAction.LOGIN_FAILED,
      details: { reason: 'account_inactive' },
      req,
    });
    return null;
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    await logAudit({
      clinicId: user.clinic_id,
      userId: user.id,
      action: AuditAction.LOGIN_FAILED,
      details: { reason: 'invalid_password' },
      req,
    });
    return null;
  }

  const userResponse = buildUserResponse(user);

  // If MFA is enabled, return a challenge instead of a full session
  if (user.mfa_enabled) {
    const mfaToken = generateMfaChallengeToken(user.id, user.clinic_id);
    return {
      mfaRequired: true,
      mfaToken,
      user: userResponse,
    };
  }

  // No MFA — create session directly
  const { accessToken, refreshToken } = await createSession(user, req);

  return {
    mfaRequired: false,
    accessToken,
    refreshToken,
    user: userResponse,
  };
}

/**
 * Complete the MFA login flow. Called after the user provides a valid TOTP code.
 *
 * @param mfaToken - The short-lived JWT returned by `login` when MFA is required
 * @param totpCode - The 6-digit TOTP code from the user's authenticator app
 * @param req - The Express request (for IP / user-agent logging)
 * @returns Session tokens + user info, or null if verification fails
 */
export async function completeMfaLogin(
  mfaToken: string,
  totpCode: string,
  req: Request
): Promise<{ accessToken: string; refreshToken: string; user: Record<string, unknown> } | null> {
  // 1. Verify the MFA challenge token
  const challenge = verifyMfaChallengeToken(mfaToken);
  if (!challenge) {
    return null;
  }

  // 2. Verify the TOTP code
  const totpValid = await verifyMfaToken(challenge.userId, totpCode);
  if (!totpValid) {
    await logAudit({
      clinicId: challenge.clinicId,
      userId: challenge.userId,
      action: AuditAction.LOGIN_FAILED,
      details: { reason: 'invalid_mfa_code' },
      req,
    });
    return null;
  }

  // 3. Re-fetch user to get current data for session creation
  const result = await query(
    `SELECT id, clinic_id, username, first_name, last_name, role, is_active, npi
     FROM users WHERE id = $1 AND clinic_id = $2`,
    [challenge.userId, challenge.clinicId]
  );

  if (result.rows.length === 0) return null;

  const user = result.rows[0];
  if (!user.is_active) return null;

  // 4. Create session (includes concurrency enforcement)
  const { accessToken, refreshToken } = await createSession(user, req);

  return {
    accessToken,
    refreshToken,
    user: buildUserResponse(user),
  };
}

export async function refreshAccessToken(
  refreshToken: string,
  req: Request
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const tokenHash = hashToken(refreshToken);

  const result = await query(
    `SELECT s.id, s.user_id, s.clinic_id, s.expires_at, s.revoked,
            u.role, u.is_active
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.refresh_token_hash = $1`,
    [tokenHash]
  );

  if (result.rows.length === 0) return null;
  const session = result.rows[0];

  if (session.revoked || !session.is_active) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  // Rotate refresh token
  const newRefreshToken = generateRefreshToken();
  const newHash = hashToken(newRefreshToken);

  await query(
    `UPDATE sessions SET refresh_token_hash = $1, last_activity = NOW() WHERE id = $2`,
    [newHash, session.id]
  );

  const payload: JWTPayload = {
    userId: session.user_id,
    clinicId: session.clinic_id,
    role: session.role as Role,
    sessionId: session.id,
  };

  return {
    accessToken: generateAccessToken(payload),
    refreshToken: newRefreshToken,
  };
}

export async function logout(sessionId: string, userId: string, clinicId: string, req: Request): Promise<void> {
  await query('UPDATE sessions SET revoked = true WHERE id = $1', [sessionId]);
  await logAudit({
    clinicId,
    userId,
    action: AuditAction.LOGOUT,
    details: { sessionId },
    req,
  });
}

export async function revokeAllSessions(userId: string, clinicId: string): Promise<void> {
  await query(
    'UPDATE sessions SET revoked = true WHERE user_id = $1 AND clinic_id = $2',
    [userId, clinicId]
  );
}

/**
 * Switch a dev user's clinic context. Creates a new session scoped to the
 * target clinic, returns fresh access + refresh tokens.
 */
export async function switchClinicContext(
  userId: string,
  targetClinicId: string,
  role: Role,
  req: Request
): Promise<{ accessToken: string; refreshToken: string; user: Record<string, unknown> } | null> {
  // Only dev users can switch clinics
  if (role !== Role.DEV) return null;

  // Fetch user info from their home clinic
  const userResult = await query(
    `SELECT id, clinic_id, username, first_name, last_name, role, npi, is_active
     FROM users WHERE id = $1`,
    [userId]
  );
  if (userResult.rows.length === 0) return null;
  const user = userResult.rows[0];
  if (!user.is_active) return null;

  // Verify target clinic exists
  const clinicResult = await query(
    `SELECT id, name FROM clinics WHERE id = $1`,
    [targetClinicId]
  );
  if (clinicResult.rows.length === 0) return null;

  // Create a session scoped to the target clinic
  // Override the user's clinic_id for session creation
  const sessionUser = { ...user, clinic_id: targetClinicId };
  const { accessToken, refreshToken } = await createSession(sessionUser, req);

  return {
    accessToken,
    refreshToken,
    user: {
      ...buildUserResponse(user),
      clinicId: targetClinicId,
      homeClinicId: user.clinic_id,
      clinicName: clinicResult.rows[0].name,
    },
  };
}
