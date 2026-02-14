import { query } from '../db';
import { AuditAction } from '../types';
import { Request } from 'express';

interface AuditParams {
  clinicId: string;
  userId: string | null;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  req?: Request;
}

export async function logAudit(params: AuditParams): Promise<void> {
  const {
    clinicId,
    userId,
    action,
    resourceType,
    resourceId,
    details = {},
    req,
  } = params;

  // Strip any PHI from details before logging
  const safeDetails = sanitizeDetails(details);

  try {
    await query(
      `INSERT INTO audit_events (clinic_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        clinicId,
        userId,
        action,
        resourceType || null,
        resourceId || null,
        JSON.stringify(safeDetails),
        req?.ip || req?.socket?.remoteAddress || 'unknown',
        req?.headers['user-agent']?.substring(0, 500) || null,
      ]
    );
  } catch (err) {
    // Audit logging failures should not crash the app but should be alarmed
    console.error('AUDIT LOG FAILURE - action:', action, 'error:', (err as Error).message);
  }
}

// Ensure no PHI ends up in audit details
function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const phiFields = [
    'ssn', 'ssn_last4', 'date_of_birth', 'dob', 'address', 'phone',
    'email', 'insurance', 'diagnosis', 'subjective', 'objective',
    'assessment', 'plan', 'password', 'password_hash', 'mfa_secret',
    'member_id', 'group_number', 'subscriber',
  ];

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    const lowerKey = key.toLowerCase();
    if (phiFields.some(f => lowerKey.includes(f))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export async function getAuditLog(
  clinicId: string,
  filters: {
    userId?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
  }
): Promise<{ events: unknown[]; total: number }> {
  const conditions: string[] = ['clinic_id = $1'];
  const params: unknown[] = [clinicId];
  let paramIndex = 2;

  if (filters.userId) {
    conditions.push(`user_id = $${paramIndex++}`);
    params.push(filters.userId);
  }
  if (filters.action) {
    conditions.push(`action = $${paramIndex++}`);
    params.push(filters.action);
  }
  if (filters.resourceType) {
    conditions.push(`resource_type = $${paramIndex++}`);
    params.push(filters.resourceType);
  }
  if (filters.resourceId) {
    conditions.push(`resource_id = $${paramIndex++}`);
    params.push(filters.resourceId);
  }
  if (filters.fromDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(filters.fromDate);
  }
  if (filters.toDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(filters.toDate);
  }

  const where = conditions.join(' AND ');
  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 50, 200);
  const offset = (page - 1) * limit;

  const countResult = await query(
    `SELECT COUNT(*) as total FROM audit_events WHERE ${where}`,
    params
  );

  const result = await query(
    `SELECT ae.*, u.first_name, u.last_name, u.username
     FROM audit_events ae
     LEFT JOIN users u ON ae.user_id = u.id
     WHERE ${where}
     ORDER BY ae.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return {
    events: result.rows,
    total: parseInt(countResult.rows[0].total, 10),
  };
}
