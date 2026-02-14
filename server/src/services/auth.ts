import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { config } from '../config';
import { query, transaction } from '../db';
import { JWTPayload, Role, AuditAction } from '../types';
import { logAudit } from './audit';
import { Request } from 'express';

const BCRYPT_ROUNDS = 12;

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

export async function login(
  username: string,
  password: string,
  req: Request
): Promise<{ accessToken: string; refreshToken: string; user: Record<string, unknown> } | null> {
  const result = await query(
    `SELECT id, clinic_id, username, password_hash, first_name, last_name, role, is_active, npi
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

  // Create session
  const sessionId = uuid();
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const absoluteTimeout = config.SESSION_ABSOLUTE_TIMEOUT_HOURS;

  await query(
    `INSERT INTO sessions (id, user_id, clinic_id, refresh_token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '${absoluteTimeout} hours')`,
    [
      sessionId,
      user.id,
      user.clinic_id,
      refreshTokenHash,
      req.ip || req.socket?.remoteAddress || 'unknown',
      req.headers['user-agent']?.substring(0, 500) || null,
    ]
  );

  // Update last login
  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

  const payload: JWTPayload = {
    userId: user.id,
    clinicId: user.clinic_id,
    role: user.role as Role,
    sessionId,
  };

  const accessToken = generateAccessToken(payload);

  await logAudit({
    clinicId: user.clinic_id,
    userId: user.id,
    action: AuditAction.LOGIN,
    details: { sessionId },
    req,
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      clinicId: user.clinic_id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      npi: user.npi,
    },
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
