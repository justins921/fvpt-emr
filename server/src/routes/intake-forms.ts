import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();

// ── Zod Schemas ──

const fieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'select', 'checkbox', 'date', 'phone', 'email', 'signature']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
});

const sectionSchema = z.object({
  title: z.string().min(1),
  fields: z.array(fieldSchema).min(1),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional().nullable(),
  sections: z.array(sectionSchema).min(1),
});

const updateTemplateSchema = createTemplateSchema.partial();

const sendSubmissionSchema = z.object({
  template_id: z.string().uuid(),
  patient_id: z.string().uuid().optional().nullable(),
  expires_hours: z.number().int().min(1).max(720).default(72),
});

const reviewSubmissionSchema = z.object({
  notes: z.string().max(2000).optional().nullable(),
});

const publicSubmitSchema = z.object({
  responses: z.record(z.string(), z.unknown()),
});

const publicSaveSchema = z.object({
  responses: z.record(z.string(), z.unknown()),
});

// ═══════════════════════════════════════════════════════════════
// STAFF ENDPOINTS (authenticated)
// ═══════════════════════════════════════════════════════════════

const staffRouter = Router();
staffRouter.use(authenticate, validateSession, tenantScope);

// ── Templates ──

// GET /templates - List templates for clinic
staffRouter.get('/templates', async (req: Request, res: Response) => {
  try {
    const { include_inactive } = req.query;

    let sql = `
      SELECT id, clinic_id, name, description, sections, is_active, created_by, created_at, updated_at
      FROM intake_form_templates
      WHERE clinic_id = $1
    `;
    const params: unknown[] = [req.auth!.clinicId];

    if (!include_inactive) {
      sql += ` AND is_active = true`;
    }

    sql += ` ORDER BY name ASC`;

    const result = await query(sql, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /templates/:id - Get single template
staffRouter.get('/templates/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, clinic_id, name, description, sections, is_active, created_by, created_at, updated_at
       FROM intake_form_templates
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /templates - Create template
staffRouter.post('/templates', requirePermission(Permission.INTAKE_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = createTemplateSchema.parse(req.body);

    const result = await query(
      `INSERT INTO intake_form_templates (clinic_id, name, description, sections, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, sections, is_active, created_by, created_at, updated_at`,
      [
        req.auth!.clinicId,
        input.name,
        input.description || null,
        JSON.stringify(input.sections),
        req.auth!.userId,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.INTAKE_TEMPLATE_CREATE,
      resourceType: 'intake_form_template',
      resourceId: result.rows[0].id,
      details: { templateName: input.name },
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

// PUT /templates/:id - Update template
staffRouter.put('/templates/:id', requirePermission(Permission.INTAKE_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = updateTemplateSchema.parse(req.body);

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    if (input.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(input.name);
    }
    if (input.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(input.description);
    }
    if (input.sections !== undefined) {
      fields.push(`sections = $${idx++}`);
      values.push(JSON.stringify(input.sections));
    }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    fields.push(`updated_at = NOW()`);

    const result = await query(
      `UPDATE intake_form_templates
       SET ${fields.join(', ')}
       WHERE id = $1 AND clinic_id = $2
       RETURNING id, name, description, sections, is_active, created_by, created_at, updated_at`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /templates/:id - Soft delete (set is_active=false)
staffRouter.delete('/templates/:id', requirePermission(Permission.INTAKE_MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE intake_form_templates
       SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING id`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    res.json({ success: true, data: { id: result.rows[0].id } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Submissions ──

// GET /submissions - List submissions with filters and pagination
staffRouter.get('/submissions', async (req: Request, res: Response) => {
  try {
    const { status, patient_id, template_id, page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = ['s.clinic_id = $1'];
    const params: unknown[] = [req.auth!.clinicId];
    let paramIdx = 2;

    if (status) {
      conditions.push(`s.status = $${paramIdx++}`);
      params.push(status);
    }
    if (patient_id) {
      conditions.push(`s.patient_id = $${paramIdx++}`);
      params.push(patient_id);
    }
    if (template_id) {
      conditions.push(`s.template_id = $${paramIdx++}`);
      params.push(template_id);
    }

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) as total FROM intake_form_submissions s WHERE ${where}`,
      params
    );

    const result = await query(
      `SELECT s.id, s.clinic_id, s.template_id, s.patient_id, s.status,
              s.submitted_at, s.reviewed_by, s.reviewed_at, s.expires_at, s.created_at,
              t.name as template_name,
              p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn as patient_mrn
       FROM intake_form_submissions s
       JOIN intake_form_templates t ON s.template_id = t.id
       LEFT JOIN patients p ON s.patient_id = p.id
       WHERE ${where}
       ORDER BY s.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limitNum, offset]
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

// GET /submissions/:id - Get single submission with responses
staffRouter.get('/submissions/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT s.*, t.name as template_name, t.sections as template_sections,
              p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn as patient_mrn,
              r.first_name as reviewer_first_name, r.last_name as reviewer_last_name
       FROM intake_form_submissions s
       JOIN intake_form_templates t ON s.template_id = t.id
       LEFT JOIN patients p ON s.patient_id = p.id
       LEFT JOIN users r ON s.reviewed_by = r.id
       WHERE s.id = $1 AND s.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Submission not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /submissions/send - Create a new submission link
staffRouter.post('/submissions/send', requirePermission(Permission.INTAKE_CREATE), async (req: Request, res: Response) => {
  try {
    const input = sendSubmissionSchema.parse(req.body);

    // Verify template exists and belongs to this clinic
    const templateResult = await query(
      `SELECT id FROM intake_form_templates WHERE id = $1 AND clinic_id = $2 AND is_active = true`,
      [input.template_id, req.auth!.clinicId]
    );

    if (templateResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    // If patient_id provided, verify patient belongs to this clinic
    if (input.patient_id) {
      const patientResult = await query(
        `SELECT id FROM patients WHERE id = $1 AND clinic_id = $2`,
        [input.patient_id, req.auth!.clinicId]
      );
      if (patientResult.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Patient not found' });
        return;
      }
    }

    const accessToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + input.expires_hours * 60 * 60 * 1000);

    const result = await query(
      `INSERT INTO intake_form_submissions (clinic_id, template_id, patient_id, access_token, status, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING id, access_token, expires_at, status, created_at`,
      [
        req.auth!.clinicId,
        input.template_id,
        input.patient_id || null,
        accessToken,
        expiresAt,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.INTAKE_SUBMIT,
      resourceType: 'intake_form_submission',
      resourceId: result.rows[0].id,
      details: { templateId: input.template_id, patientId: input.patient_id || null },
      req,
    });

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        access_token: result.rows[0].access_token,
        expires_at: result.rows[0].expires_at,
        status: result.rows[0].status,
        created_at: result.rows[0].created_at,
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

// PUT /submissions/:id/review - Mark as reviewed
staffRouter.put('/submissions/:id/review', requirePermission(Permission.INTAKE_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = reviewSubmissionSchema.parse(req.body);

    // Verify submission exists, belongs to clinic, and is completed
    const existing = await query(
      `SELECT id, status FROM intake_form_submissions WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Submission not found' });
      return;
    }

    if (existing.rows[0].status !== 'completed') {
      res.status(400).json({ success: false, error: 'Only completed submissions can be reviewed' });
      return;
    }

    const result = await query(
      `UPDATE intake_form_submissions
       SET status = 'reviewed', reviewed_by = $3, reviewed_at = NOW(), review_notes = $4, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING id, status, reviewed_by, reviewed_at`,
      [req.params.id, req.auth!.clinicId, req.auth!.userId, input.notes || null]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.INTAKE_REVIEW,
      resourceType: 'intake_form_submission',
      resourceId: req.params.id,
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

// POST /submissions/:id/apply - Apply submission responses to patient record
staffRouter.post('/submissions/:id/apply', requirePermission(Permission.INTAKE_MANAGE), async (req: Request, res: Response) => {
  try {
    // Get submission with responses
    const submissionResult = await query(
      `SELECT s.*, t.sections as template_sections
       FROM intake_form_submissions s
       JOIN intake_form_templates t ON s.template_id = t.id
       WHERE s.id = $1 AND s.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (submissionResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Submission not found' });
      return;
    }

    const submission = submissionResult.rows[0];

    if (submission.status !== 'completed' && submission.status !== 'reviewed') {
      res.status(400).json({ success: false, error: 'Submission must be completed or reviewed before applying' });
      return;
    }

    if (!submission.patient_id) {
      res.status(400).json({ success: false, error: 'Submission must be linked to a patient before applying' });
      return;
    }

    const responses = typeof submission.responses === 'string'
      ? JSON.parse(submission.responses)
      : submission.responses || {};

    // Map common form field names to patient table columns
    const fieldMapping: Record<string, string> = {
      'first_name': 'first_name',
      'last_name': 'last_name',
      'date_of_birth': 'date_of_birth',
      'gender': 'gender',
      'email': 'email',
      'phone': 'phone',
      'address_line1': 'address_line1',
      'address_line2': 'address_line2',
      'city': 'city',
      'state': 'state',
      'zip': 'zip',
      'emergency_contact_name': 'emergency_contact_name',
      'emergency_contact_phone': 'emergency_contact_phone',
      'guarantor_name': 'guarantor_name',
      'guarantor_phone': 'guarantor_phone',
      'guarantor_relationship': 'guarantor_relationship',
      'referral_source': 'referral_source',
      'referring_provider': 'referring_provider',
      'referring_provider_npi': 'referring_provider_npi',
      'primary_diagnosis_icd10': 'primary_diagnosis_icd10',
      'precautions': 'precautions',
    };

    const updateFields: string[] = [];
    const updateValues: unknown[] = [];
    let idx = 3;

    for (const [formField, dbColumn] of Object.entries(fieldMapping)) {
      if (responses[formField] !== undefined && responses[formField] !== null && responses[formField] !== '') {
        updateFields.push(`${dbColumn} = $${idx++}`);
        updateValues.push(responses[formField]);
      }
    }

    if (updateFields.length > 0) {
      updateFields.push(`updated_at = NOW()`);

      await query(
        `UPDATE patients SET ${updateFields.join(', ')} WHERE id = $1 AND clinic_id = $2`,
        [submission.patient_id, req.auth!.clinicId, ...updateValues]
      );
    }

    // Handle insurance data if present
    if (responses['insurance_payer_name'] && responses['insurance_member_id']) {
      // Check if the patient already has a primary insurance entry
      const existingInsurance = await query(
        `SELECT id FROM insurance WHERE patient_id = $1 AND clinic_id = $2 AND is_primary = true AND is_active = true`,
        [submission.patient_id, req.auth!.clinicId]
      );

      if (existingInsurance.rows.length > 0) {
        await query(
          `UPDATE insurance
           SET payer_name = $3, member_id = $4, group_number = $5, subscriber_name = $6,
               subscriber_dob = $7, subscriber_relationship = $8, updated_at = NOW()
           WHERE id = $1 AND clinic_id = $2`,
          [
            existingInsurance.rows[0].id,
            req.auth!.clinicId,
            responses['insurance_payer_name'],
            responses['insurance_member_id'],
            responses['insurance_group_number'] || null,
            responses['insurance_subscriber_name'] || null,
            responses['insurance_subscriber_dob'] || null,
            responses['insurance_subscriber_relationship'] || 'self',
          ]
        );
      } else {
        await query(
          `INSERT INTO insurance (clinic_id, patient_id, payer_name, payer_id, member_id, group_number,
             subscriber_name, subscriber_dob, subscriber_relationship, coverage_start, is_primary, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, true, true)`,
          [
            req.auth!.clinicId,
            submission.patient_id,
            responses['insurance_payer_name'],
            responses['insurance_payer_id'] || '',
            responses['insurance_member_id'],
            responses['insurance_group_number'] || null,
            responses['insurance_subscriber_name'] || responses['first_name'] + ' ' + responses['last_name'],
            responses['insurance_subscriber_dob'] || responses['date_of_birth'] || null,
            responses['insurance_subscriber_relationship'] || 'self',
          ]
        );
      }
    }

    // Mark submission as applied
    await query(
      `UPDATE intake_form_submissions SET applied_at = NOW(), applied_by = $3, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId, req.auth!.userId]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.INTAKE_REVIEW,
      resourceType: 'intake_form_submission',
      resourceId: req.params.id,
      details: { appliedToPatient: submission.patient_id, fieldsApplied: updateFields.length },
      req,
    });

    res.json({
      success: true,
      data: {
        id: req.params.id,
        patient_id: submission.patient_id,
        fields_applied: updateFields.length,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS (no auth - accessed by patients via token)
// ═══════════════════════════════════════════════════════════════

const publicRouter = Router();

// GET /public/:token - Get form template and any existing responses
publicRouter.get('/public/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const result = await query(
      `SELECT s.id, s.status, s.responses, s.expires_at, s.submitted_at,
              t.name as template_name, t.description as template_description, t.sections as template_sections
       FROM intake_form_submissions s
       JOIN intake_form_templates t ON s.template_id = t.id
       WHERE s.access_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Form not found' });
      return;
    }

    const submission = result.rows[0];

    // Check if expired
    if (new Date(submission.expires_at) < new Date()) {
      res.status(410).json({ success: false, error: 'This form link has expired' });
      return;
    }

    // Check if already completed
    if (submission.status === 'completed' || submission.status === 'reviewed') {
      res.status(410).json({ success: false, error: 'This form has already been submitted' });
      return;
    }

    res.json({
      success: true,
      data: {
        submission_id: submission.id,
        status: submission.status,
        template_name: submission.template_name,
        template_description: submission.template_description,
        sections: submission.template_sections,
        responses: submission.responses || {},
        expires_at: submission.expires_at,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /public/:token - Submit responses (final submission)
publicRouter.put('/public/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const input = publicSubmitSchema.parse(req.body);

    // Look up submission
    const existing = await query(
      `SELECT s.id, s.clinic_id, s.status, s.expires_at, t.sections as template_sections
       FROM intake_form_submissions s
       JOIN intake_form_templates t ON s.template_id = t.id
       WHERE s.access_token = $1`,
      [token]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Form not found' });
      return;
    }

    const submission = existing.rows[0];

    // Check if expired
    if (new Date(submission.expires_at) < new Date()) {
      res.status(410).json({ success: false, error: 'This form link has expired' });
      return;
    }

    // Check if already completed
    if (submission.status === 'completed' || submission.status === 'reviewed') {
      res.status(410).json({ success: false, error: 'This form has already been submitted' });
      return;
    }

    // Validate required fields
    const sections = typeof submission.template_sections === 'string'
      ? JSON.parse(submission.template_sections)
      : submission.template_sections;

    const missingFields: string[] = [];
    for (const section of sections) {
      for (const field of section.fields) {
        if (field.required && (input.responses[field.name] === undefined || input.responses[field.name] === null || input.responses[field.name] === '')) {
          missingFields.push(field.label);
        }
      }
    }

    if (missingFields.length > 0) {
      res.status(400).json({
        success: false,
        error: 'Required fields are missing',
        details: missingFields,
      });
      return;
    }

    const result = await query(
      `UPDATE intake_form_submissions
       SET status = 'completed', responses = $2, submitted_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, submitted_at`,
      [submission.id, JSON.stringify(input.responses)]
    );

    await logAudit({
      clinicId: submission.clinic_id,
      userId: null,
      action: AuditAction.INTAKE_SUBMIT,
      resourceType: 'intake_form_submission',
      resourceId: submission.id,
      details: { submittedViaPublicLink: true },
      req,
    });

    res.json({
      success: true,
      data: {
        id: result.rows[0].id,
        status: result.rows[0].status,
        submitted_at: result.rows[0].submitted_at,
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

// PUT /public/:token/save - Save partial progress
publicRouter.put('/public/:token/save', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const input = publicSaveSchema.parse(req.body);

    // Look up submission
    const existing = await query(
      `SELECT id, status, expires_at FROM intake_form_submissions WHERE access_token = $1`,
      [token]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Form not found' });
      return;
    }

    const submission = existing.rows[0];

    // Check if expired
    if (new Date(submission.expires_at) < new Date()) {
      res.status(410).json({ success: false, error: 'This form link has expired' });
      return;
    }

    // Check if already completed
    if (submission.status === 'completed' || submission.status === 'reviewed') {
      res.status(410).json({ success: false, error: 'This form has already been submitted' });
      return;
    }

    const result = await query(
      `UPDATE intake_form_submissions
       SET status = 'in_progress', responses = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, updated_at`,
      [submission.id, JSON.stringify(input.responses)]
    );

    res.json({
      success: true,
      data: {
        id: result.rows[0].id,
        status: result.rows[0].status,
        updated_at: result.rows[0].updated_at,
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

// ═══════════════════════════════════════════════════════════════
// Mount both routers onto the main router
// ═══════════════════════════════════════════════════════════════

router.use('/', publicRouter);
router.use('/', staffRouter);

export default router;
