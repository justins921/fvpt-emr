import { query } from '../db';
import { AuditAction } from '../types';
import { logAudit } from './audit';
import { Request } from 'express';

export type ConsentChannel = 'sms' | 'email';
export type ConsentSource =
  | 'intake'
  | 'front-desk'
  | 'staff'
  | 'stop-keyword'
  | 'start-keyword'
  | 'migration-default';

interface ConsentPrefs {
  sms_opt_in: boolean;
  email_opt_in: boolean;
  sms_opt_in_at: string | null;
  email_opt_in_at: string | null;
  sms_opt_in_source: string | null;
  email_opt_in_source: string | null;
}

/** Read the current communication preferences for a patient (defaults true when unset). */
export async function getConsentPrefs(patientId: string, clinicId: string): Promise<ConsentPrefs | null> {
  const result = await query(
    `SELECT sms_opt_in, email_opt_in, sms_opt_in_at, email_opt_in_at,
            sms_opt_in_source, email_opt_in_source
     FROM patients WHERE id = $1 AND clinic_id = $2`,
    [patientId, clinicId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    sms_opt_in: r.sms_opt_in !== false,
    email_opt_in: r.email_opt_in !== false,
    sms_opt_in_at: r.sms_opt_in_at,
    email_opt_in_at: r.email_opt_in_at,
    sms_opt_in_source: r.sms_opt_in_source,
    email_opt_in_source: r.email_opt_in_source,
  };
}

/** Consent history for a patient, newest first. */
export async function getConsentHistory(patientId: string, clinicId: string) {
  const result = await query(
    `SELECT l.*, u.first_name AS changed_by_first, u.last_name AS changed_by_last
     FROM communication_consent_log l
     LEFT JOIN users u ON l.changed_by = u.id
     WHERE l.patient_id = $1 AND l.clinic_id = $2
     ORDER BY l.changed_at DESC`,
    [patientId, clinicId]
  );
  return result.rows;
}

interface SetConsentParams {
  patientId: string;
  clinicId: string;
  channel: ConsentChannel;
  optIn: boolean;
  source: ConsentSource;
  changedBy: string | null;
  req?: Request;
}

/**
 * Set a patient's consent for a channel. Writes the patient flag + timestamp +
 * source, appends to the immutable consent log, and records an audit event.
 * Returns the previous value (null when the patient was not found).
 */
export async function setConsent(params: SetConsentParams): Promise<boolean | null> {
  const { patientId, clinicId, channel, optIn, source, changedBy, req } = params;
  const flagCol = channel === 'sms' ? 'sms_opt_in' : 'email_opt_in';
  const atCol = channel === 'sms' ? 'sms_opt_in_at' : 'email_opt_in_at';
  const srcCol = channel === 'sms' ? 'sms_opt_in_source' : 'email_opt_in_source';

  const current = await query(
    `SELECT ${flagCol} AS flag FROM patients WHERE id = $1 AND clinic_id = $2`,
    [patientId, clinicId]
  );
  if (current.rows.length === 0) return null;
  const oldValue: boolean = current.rows[0].flag !== false;

  // Idempotent: still log the attempt so keyword replays are visible, but skip the write
  if (oldValue === optIn) {
    return oldValue;
  }

  await query(
    `UPDATE patients SET ${flagCol} = $1, ${atCol} = NOW(), ${srcCol} = $2
     WHERE id = $3 AND clinic_id = $4`,
    [optIn, source, patientId, clinicId]
  );

  await query(
    `INSERT INTO communication_consent_log (clinic_id, patient_id, channel, old_value, new_value, changed_by, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [clinicId, patientId, channel, oldValue, optIn, changedBy, source]
  );

  await logAudit({
    clinicId,
    userId: changedBy,
    action: AuditAction.CONSENT_CHANGE,
    resourceType: 'patient',
    resourceId: patientId,
    details: { channel, oldValue, newValue: optIn, source },
    req,
  });

  return oldValue;
}

/**
 * Record a send that was skipped because the patient opted out.
 * NOTE: future email send paths MUST call this gate (check `email_opt_in`)
 * before sending, the same way SMS paths check `sms_opt_in`.
 */
export async function logSkippedSend(
  clinicId: string,
  userId: string | null,
  patientId: string,
  channel: ConsentChannel,
  reason: string,
  req?: Request
): Promise<void> {
  await logAudit({
    clinicId,
    userId,
    action: AuditAction.CONSENT_SKIP_SEND,
    resourceType: 'patient',
    resourceId: patientId,
    details: { channel, reason },
    req,
  });
}
