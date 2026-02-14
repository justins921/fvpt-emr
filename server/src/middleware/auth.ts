import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../db';
import { JWTPayload, Permission, Role, ROLE_PERMISSIONS } from '../types';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      auth?: JWTPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JWTPayload;
    req.auth = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ success: false, error: 'Token expired' });
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

export async function validateSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.auth) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  try {
    const result = await query(
      `SELECT id, last_activity, expires_at, revoked 
       FROM sessions 
       WHERE id = $1 AND user_id = $2 AND clinic_id = $3`,
      [req.auth.sessionId, req.auth.userId, req.auth.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ success: false, error: 'Session not found' });
      return;
    }

    const session = result.rows[0];

    if (session.revoked) {
      res.status(401).json({ success: false, error: 'Session revoked' });
      return;
    }

    if (new Date(session.expires_at) < new Date()) {
      res.status(401).json({ success: false, error: 'Session expired' });
      return;
    }

    // Check idle timeout
    const idleMs = config.SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000;
    const lastActivity = new Date(session.last_activity).getTime();
    if (Date.now() - lastActivity > idleMs) {
      await query('UPDATE sessions SET revoked = true WHERE id = $1', [session.id]);
      res.status(401).json({ success: false, error: 'Session idle timeout' });
      return;
    }

    // Update last activity
    await query(
      'UPDATE sessions SET last_activity = NOW() WHERE id = $1',
      [session.id]
    );

    next();
  } catch (err) {
    console.error('Session validation error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const userPermissions = ROLE_PERMISSIONS[req.auth.role as Role] || [];
    const hasAll = permissions.every(p => userPermissions.includes(p));

    if (!hasAll) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.auth.role as Role)) {
      res.status(403).json({ success: false, error: 'Insufficient role' });
      return;
    }

    next();
  };
}

// Ensure tenant isolation - all queries must be scoped to clinic_id
export function tenantScope(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth?.clinicId) {
    res.status(403).json({ success: false, error: 'Tenant context required' });
    return;
  }
  next();
}
