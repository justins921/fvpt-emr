import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../db';
import { authenticate, validateSession, tenantScope, requirePermission } from '../middleware/auth';
import { authenticatePortalUser, requireActivePortalUser } from './portal';
import { loginLimiter } from '../middleware/security';
import { logAudit } from '../services/audit';
import { AuditAction, Permission } from '../types';

/**
 * Patient-facing portal endpoints (beyond HEP and booking).
 *
 * Mounted at /api/portal/patient. Authenticated via the portal JWT
 * (authenticatePortalUser), NOT staff requirePermission. Every query is
 * scoped to req.portal.patientId / req.portal.clinicId — the patient can
 * only ever see their own data.
 *
 * The self-registration endpoint (POST /api/portal/register) is public
 * and rate-limited. New accounts are created INACTIVE (pending staff
 * verification) so a stranger can't claim someone else's chart by
 * guessing their name and date of birth.
 */
const router = Router();

// ═══════════════════════════════════════════════════════════════════
// PUBLIC: self-registration
// ═══════════════════════════════════════════════════════════════════

const registerSchema = z.object({
  portal_code: z.string().min(1).max(12),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
  gender: z.enum(['male', 'female', 'other', 'unknown']),
  email: z.string().email().max(255),
  phone: z.string().max(20).optional().nullable(),
  password: z.string().min(12).max(128),
});

// POST /api/portal/register — patient self-registration (public, rate-limited)
router.post('/register', loginLimiter, async (req: Request, res: Response) => {
  try {
    const input = registerSchema.parse(req.body);

    // Resolve clinic from the human-friendly portal code.
    const clinicResult = await query(
      `SELECT c.id, c.name,
              COALESCE(cps.allow_patient_self_registration, true) AS allow_registration
       FROM clinics c
       LEFT JOIN clinic_portal_settings cps ON cps.clinic_id = c.id
       WHERE UPPER(c.portal_code) = UPPER($1)`,
      [input.portal_code.trim()]
    );
    if (clinicResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Clinic code not recognized. Check with your clinic for the correct code.' });
      return;
    }
    const clinic = clinicResult.rows[0];
    if (!clinic.allow_registration) {
      res.status(403).json({ success: false, error: 'Online registration is not enabled for this clinic. Please contact the front desk.' });
      return;
    }
    const clinicId = clinic.id;

    // Duplicate email within this clinic?
    const dupEmail = await query(
      `SELECT id FROM portal_users WHERE email = $1 AND clinic_id = $2`,
      [input.email.toLowerCase(), clinicId]
    );
    if (dupEmail.rows.length > 0) {
      res.status(409).json({ success: false, error: 'An account with this email already exists. Try signing in instead.' });
      return;
    }

    // Does a patient record already match (name + DOB)? If so, link to it
    // instead of creating a duplicate — but keep the account inactive until
    // staff verify identity (prevents chart hijacking by name/DOB guessing).
    const existingPatient = await query(
      `SELECT id FROM patients
       WHERE clinic_id = $1
         AND LOWER(first_name) = LOWER($2)
         AND LOWER(last_name) = LOWER($3)
         AND date_of_birth = $4
       LIMIT 1`,
      [clinicId, input.first_name.trim(), input.last_name.trim(), input.date_of_birth]
    );

    let patientId: string;
    if (existingPatient.rows.length > 0) {
      patientId = existingPatient.rows[0].id;
      // Already has a portal account?
      const existingPortal = await query(
        `SELECT id FROM portal_users WHERE patient_id = $1 AND clinic_id = $2`,
        [patientId, clinicId]
      );
      if (existingPortal.rows.length > 0) {
        res.status(409).json({ success: false, error: 'This patient already has a portal account. Try signing in or contact the front desk.' });
        return;
      }
      // Update contact info from registration (patient may have new email/phone).
      await query(
        `UPDATE patients SET email = $1, phone = COALESCE($2, phone), updated_at = NOW()
         WHERE id = $3`,
        [input.email.toLowerCase(), input.phone?.trim() || null, patientId]
      );
    } else {
      // New patient record — generate an MRN.
      const mrnResult = await query(
        `SELECT COALESCE(MAX(CAST(NULLIF(REGEXP_REPLACE(mrn, '[^0-9]', '', 'g'), '') AS INTEGER)), 1000) + 1 AS next_mrn
         FROM patients WHERE clinic_id = $1 AND mrn ~ '^[0-9]+$'`,
        [clinicId]
      );
      const mrn = String(mrnResult.rows[0]?.next_mrn ?? 1001);
      const newPatient = await query(
        `INSERT INTO patients (clinic_id, mrn, first_name, last_name, date_of_birth, gender, email, phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          clinicId, mrn,
          input.first_name.trim(), input.last_name.trim(),
          input.date_of_birth, input.gender,
          input.email.toLowerCase(), input.phone?.trim() || null,
        ]
      );
      patientId = newPatient.rows[0].id;
    }

    // Create the portal user as INACTIVE — staff verify identity before activation.
    const passwordHash = await bcrypt.hash(input.password, 12);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    await query(
      `INSERT INTO portal_users (clinic_id, patient_id, email, password_hash, verification_token, is_active, email_verified)
       VALUES ($1, $2, $3, $4, $5, false, false)`,
      [clinicId, patientId, input.email.toLowerCase(), passwordHash, verificationToken]
    );

    await logAudit({
      clinicId,
      userId: null,
      action: AuditAction.PORTAL_USER_CREATE,
      resourceType: 'portal_user',
      resourceId: patientId,
      details: { source: 'self_registration' },
      req,
    });

    res.status(201).json({
      success: true,
      data: {
        clinic_name: clinic.name,
        message: 'Account created. The clinic will verify your identity before activating your portal access.',
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

// ═══════════════════════════════════════════════════════════════════
// AUTHENTICATED patient endpoints
// ═══════════════════════════════════════════════════════════════════

const patientRouter = Router();
patientRouter.use(authenticatePortalUser, requireActivePortalUser);

// ── GET /appointments/upcoming — patient's upcoming appointments ────────────
patientRouter.get('/appointments/upcoming', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    const result = await query(
      `SELECT a.id, a.start_time, a.end_time, a.appointment_type, a.status, a.notes,
              u.first_name AS therapist_first_name, u.last_name AS therapist_last_name
       FROM appointments a
       JOIN users u ON u.id = a.therapist_id
       WHERE a.patient_id = $1 AND a.clinic_id = $2
         AND a.status IN ('scheduled', 'checked_in')
         AND a.start_time >= NOW() - INTERVAL '1 hour'
       ORDER BY a.start_time ASC`,
      [patientId, clinicId]
    );
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /intake-forms — forms assigned to this patient, not yet completed ────
patientRouter.get('/intake-forms', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    const result = await query(
      `SELECT s.id AS submission_id, s.status, s.expires_at, s.submitted_at,
              t.id AS template_id, t.name AS template_name, t.description AS template_description
       FROM intake_form_submissions s
       JOIN intake_form_templates t ON t.id = s.template_id
       WHERE s.patient_id = $1 AND s.clinic_id = $2
         AND s.status IN ('pending', 'in_progress')
         AND (s.expires_at IS NULL OR s.expires_at > NOW())
       ORDER BY s.created_at DESC`,
      [patientId, clinicId]
    );
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /intake-forms/:id — single form with template sections ───────────────
patientRouter.get('/intake-forms/:id', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    const result = await query(
      `SELECT s.id AS submission_id, s.status, s.responses, s.expires_at,
              t.name AS template_name, t.description AS template_description,
              t.sections
       FROM intake_form_submissions s
       JOIN intake_form_templates t ON t.id = s.template_id
       WHERE s.id = $1 AND s.patient_id = $2 AND s.clinic_id = $3`,
      [req.params.id, patientId, clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Form not found' });
      return;
    }
    const row = result.rows[0];
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      res.status(410).json({ success: false, error: 'This form has expired' });
      return;
    }
    res.json({
      success: true,
      data: {
        submission_id: row.submission_id,
        status: row.status,
        template_name: row.template_name,
        template_description: row.template_description,
        sections: typeof row.sections === 'string' ? JSON.parse(row.sections) : row.sections,
        responses: row.responses || {},
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const intakeSubmitSchema = z.object({
  responses: z.record(z.string(), z.unknown()),
});

// ── PUT /intake-forms/:id — submit patient responses ─────────────────────────
patientRouter.put('/intake-forms/:id', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    const input = intakeSubmitSchema.parse(req.body);

    const existing = await query(
      `SELECT s.id, s.status, s.expires_at, t.sections
       FROM intake_form_submissions s
       JOIN intake_form_templates t ON t.id = s.template_id
       WHERE s.id = $1 AND s.patient_id = $2 AND s.clinic_id = $3`,
      [req.params.id, patientId, clinicId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Form not found' });
      return;
    }
    const submission = existing.rows[0];
    if (submission.expires_at && new Date(submission.expires_at) < new Date()) {
      res.status(410).json({ success: false, error: 'This form has expired' });
      return;
    }
    if (submission.status === 'completed' || submission.status === 'reviewed') {
      res.status(410).json({ success: false, error: 'This form has already been submitted' });
      return;
    }

    // Validate required fields against the template schema.
    const sections = typeof submission.sections === 'string'
      ? JSON.parse(submission.sections)
      : submission.sections;
    const missing: string[] = [];
    for (const section of sections || []) {
      for (const field of section.fields || []) {
        const v = input.responses[field.name];
        if (field.required && (v === undefined || v === null || v === '')) {
          missing.push(field.label);
        }
      }
    }
    if (missing.length > 0) {
      res.status(400).json({ success: false, error: 'Required fields are missing', details: missing });
      return;
    }

    await query(
      `UPDATE intake_form_submissions
       SET status = 'completed', responses = $2, submitted_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [req.params.id, JSON.stringify(input.responses)]
    );

    res.json({ success: true, data: { submitted: true } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /statement — patient balance + itemized ledger ───────────────────────
patientRouter.get('/statement', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;

    const ledgerResult = await query(
      `SELECT id, entry_type, amount_cents, description, cpt_code,
              service_date, payer_name, posted_at
       FROM ledger_entries
       WHERE clinic_id = $1 AND patient_id = $2
       ORDER BY COALESCE(service_date, posted_at::date) ASC, posted_at ASC`,
      [clinicId, patientId]
    );

    let runningBalance = 0;
    const items: Array<{
      date: string;
      description: string | null;
      charges: number;
      payments: number;
      adjustments: number;
      balance: number;
    }> = [];
    for (const entry of ledgerResult.rows) {
      const date = entry.service_date || new Date(entry.posted_at).toISOString().split('T')[0];
      let charges = 0;
      let payments = 0;
      let adjustments = 0;
      if (entry.entry_type === 'charge') {
        charges = entry.amount_cents;
        runningBalance += entry.amount_cents;
      } else if (entry.entry_type === 'payment') {
        payments = entry.amount_cents;
        runningBalance -= entry.amount_cents;
      } else if (entry.entry_type === 'adjustment' || entry.entry_type === 'write_off') {
        adjustments = entry.amount_cents;
        runningBalance -= entry.amount_cents;
      } else if (entry.entry_type === 'refund') {
        payments = -entry.amount_cents;
        runningBalance += entry.amount_cents;
      }
      items.push({ date, description: entry.description, charges, payments, adjustments, balance: runningBalance });
    }

    // Payment history from completed payment transactions.
    const paymentsResult = await query(
      `SELECT id, amount_cents, status, description, created_at
       FROM payment_transactions
       WHERE clinic_id = $1 AND patient_id = $2 AND status = 'completed'
       ORDER BY created_at DESC
       LIMIT 50`,
      [clinicId, patientId]
    );

    res.json({
      success: true,
      data: {
        statement_date: new Date().toISOString().split('T')[0],
        total_balance_due: runningBalance,
        items,
        payment_history: paymentsResult.rows,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export { router as portalPatientPublicRouter, patientRouter as portalPatientRouter };

// ═══════════════════════════════════════════════════════════════════
// STAFF: portal settings (clinic code + self-registration toggle)
// ═══════════════════════════════════════════════════════════════════

const staffRouter = Router();
staffRouter.use(authenticate, validateSession, tenantScope);

// GET /portal/settings — clinic portal code + self-registration setting
staffRouter.get(
  '/settings',
  requirePermission(Permission.PORTAL_MANAGE),
  async (req: Request, res: Response) => {
    try {
      const clinicId = req.auth!.clinicId;
      const result = await query(
        `SELECT c.portal_code,
                COALESCE(cps.allow_patient_self_registration, true) AS allow_patient_self_registration
         FROM clinics c
         LEFT JOIN clinic_portal_settings cps ON cps.clinic_id = c.id
         WHERE c.id = $1`,
        [clinicId]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Clinic not found' });
        return;
      }
      res.json({ success: true, data: result.rows[0] });
    } catch {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

const settingsSchema = z.object({
  allow_patient_self_registration: z.boolean(),
});

// PUT /portal/settings — toggle patient self-registration
staffRouter.put(
  '/settings',
  requirePermission(Permission.PORTAL_MANAGE),
  async (req: Request, res: Response) => {
    try {
      const clinicId = req.auth!.clinicId;
      const input = settingsSchema.parse(req.body);
      await query(
        `INSERT INTO clinic_portal_settings (clinic_id, allow_patient_self_registration, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (clinic_id)
         DO UPDATE SET allow_patient_self_registration = $2, updated_at = NOW()`,
        [clinicId, input.allow_patient_self_registration]
      );
      await logAudit({
        clinicId,
        userId: req.auth!.userId,
        action: AuditAction.PORTAL_USER_CREATE,
        resourceType: 'clinic_portal_settings',
        resourceId: clinicId,
        details: { allow_patient_self_registration: input.allow_patient_self_registration },
        req,
      });
      res.json({ success: true, data: { allow_patient_self_registration: input.allow_patient_self_registration } });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

export { staffRouter as portalPatientStaffRouter };
