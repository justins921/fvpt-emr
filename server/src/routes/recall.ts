import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Zod Schemas ──

const campaignSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  criteria: z.object({
    days_since_discharge: z.number().int().positive(),
    diagnosis_codes: z.array(z.string()).optional(),
    min_visits: z.number().int().positive().optional(),
  }),
  messageTemplate: z.string().min(1).max(2000),
  channel: z.enum(['sms', 'email', 'both']),
  scheduledDate: z.string().datetime().optional().nullable(),
});

// ── List campaigns ──
router.get('/', requirePermission(Permission.RECALL_VIEW), async (req: Request, res: Response) => {
  try {
    const { status, page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'rc.clinic_id = $1';
    const params: unknown[] = [req.auth!.clinicId];

    if (status) {
      whereClause += ` AND rc.status = $${params.length + 1}`;
      params.push(status);
    }

    const countResult = await query(
      `SELECT COUNT(*) as total FROM recall_campaigns rc WHERE ${whereClause}`,
      params
    );

    const result = await query(
      `SELECT rc.id, rc.name, rc.description, rc.criteria, rc.message_template,
              rc.channel, rc.scheduled_date, rc.status, rc.created_at, rc.updated_at,
              u.first_name as created_by_first_name, u.last_name as created_by_last_name,
              (SELECT COUNT(*) FROM recall_entries re WHERE re.campaign_id = rc.id) as entry_count
       FROM recall_campaigns rc
       LEFT JOIN users u ON rc.created_by = u.id
       WHERE ${whereClause}
       ORDER BY rc.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
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

// ── Get campaign with entry summary ──
router.get('/:id', requirePermission(Permission.RECALL_VIEW), async (req: Request, res: Response) => {
  try {
    const campaignResult = await query(
      `SELECT rc.*,
              u.first_name as created_by_first_name, u.last_name as created_by_last_name
       FROM recall_campaigns rc
       LEFT JOIN users u ON rc.created_by = u.id
       WHERE rc.id = $1 AND rc.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (campaignResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found' });
      return;
    }

    // Get entry counts by status
    const summaryResult = await query(
      `SELECT
         COUNT(*) as total_entries,
         COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
         COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
         COUNT(*) FILTER (WHERE status = 'delivered') as delivered_count,
         COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
         COUNT(*) FILTER (WHERE status = 'responded') as responded_count
       FROM recall_entries
       WHERE campaign_id = $1`,
      [req.params.id]
    );

    const campaign = campaignResult.rows[0];
    campaign.entry_summary = summaryResult.rows[0];

    res.json({ success: true, data: campaign });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Create campaign ──
router.post('/', requirePermission(Permission.RECALL_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = campaignSchema.parse(req.body);

    const result = await query(
      `INSERT INTO recall_campaigns (
        clinic_id, name, description, criteria, message_template,
        channel, scheduled_date, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8)
      RETURNING id`,
      [
        req.auth!.clinicId,
        input.name,
        input.description || null,
        JSON.stringify(input.criteria),
        input.messageTemplate,
        input.channel,
        input.scheduledDate || null,
        req.auth!.userId,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.RECALL_CREATE,
      resourceType: 'recall_campaign',
      resourceId: result.rows[0].id,
      details: { name: input.name, channel: input.channel },
      req,
    });

    res.status(201).json({ success: true, data: { id: result.rows[0].id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Update campaign ──
router.put('/:id', requirePermission(Permission.RECALL_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = campaignSchema.partial().parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      messageTemplate: 'message_template',
      channel: 'channel',
      scheduledDate: 'scheduled_date',
    };

    for (const [key, value] of Object.entries(input)) {
      if (key === 'criteria') {
        fields.push(`criteria = $${idx++}`);
        values.push(JSON.stringify(value));
      } else if (fieldMap[key]) {
        fields.push(`${fieldMap[key]} = $${idx++}`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    const result = await query(
      `UPDATE recall_campaigns SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.RECALL_CREATE,
      resourceType: 'recall_campaign',
      resourceId: req.params.id,
      details: { action: 'update', updatedFields: Object.keys(input) },
      req,
    });

    res.json({ success: true, data: { id: req.params.id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Generate recall entries ──
// Query patients matching criteria and create recall_entries for each match
router.post('/:id/generate', requirePermission(Permission.RECALL_MANAGE), async (req: Request, res: Response) => {
  try {
    // Verify campaign exists and belongs to this clinic
    const campaignResult = await query(
      `SELECT id, criteria, status FROM recall_campaigns WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (campaignResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found' });
      return;
    }

    const campaign = campaignResult.rows[0];
    const criteria = typeof campaign.criteria === 'string'
      ? JSON.parse(campaign.criteria)
      : campaign.criteria;

    // Build patient query: discharged patients, not seen in X days, matching diagnosis
    let patientWhere = `p.clinic_id = $1 AND p.is_active = true`;
    const patientParams: unknown[] = [req.auth!.clinicId];

    // Patients whose most recent appointment is a discharge or whose last visit
    // was more than days_since_discharge ago
    if (criteria.days_since_discharge) {
      patientWhere += `
        AND NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.patient_id = p.id AND a.clinic_id = $1
            AND a.status = 'completed'
            AND a.start_time > NOW() - INTERVAL '1 day' * $${patientParams.length + 1}
        )`;
      patientParams.push(criteria.days_since_discharge);
    }

    // Filter by diagnosis codes if provided
    if (criteria.diagnosis_codes && criteria.diagnosis_codes.length > 0) {
      patientWhere += `
        AND (
          p.primary_diagnosis_icd10 = ANY($${patientParams.length + 1})
          OR p.secondary_diagnoses_icd10 && $${patientParams.length + 1}::text[]
        )`;
      patientParams.push(criteria.diagnosis_codes);
    }

    // Minimum visits filter
    if (criteria.min_visits) {
      patientWhere += `
        AND (
          SELECT COUNT(*) FROM appointments a2
          WHERE a2.patient_id = p.id AND a2.clinic_id = $1
            AND a2.status = 'completed'
        ) >= $${patientParams.length + 1}`;
      patientParams.push(criteria.min_visits);
    }

    const matchingPatients = await query(
      `SELECT p.id, p.first_name, p.last_name, p.phone, p.email
       FROM patients p
       WHERE ${patientWhere}
       ORDER BY p.last_name, p.first_name`,
      patientParams
    );

    // Remove patients who already have an entry in this campaign
    const existingEntries = await query(
      `SELECT patient_id FROM recall_entries WHERE campaign_id = $1`,
      [req.params.id]
    );
    const existingPatientIds = new Set(existingEntries.rows.map((r: { patient_id: string }) => r.patient_id));

    let created = 0;
    let skipped = 0;

    for (const patient of matchingPatients.rows) {
      if (existingPatientIds.has(patient.id)) {
        skipped++;
        continue;
      }

      await query(
        `INSERT INTO recall_entries (campaign_id, patient_id, status)
         VALUES ($1, $2, 'pending')`,
        [req.params.id, patient.id]
      );
      created++;
    }

    // Update campaign status to generated
    await query(
      `UPDATE recall_campaigns SET status = 'generated', updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.RECALL_CREATE,
      resourceType: 'recall_campaign',
      resourceId: req.params.id,
      details: { action: 'generate', matchedPatients: matchingPatients.rows.length, created, skipped },
      req,
    });

    res.json({
      success: true,
      data: {
        matchedPatients: matchingPatients.rows.length,
        entriesCreated: created,
        entriesSkipped: skipped,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Send campaign ──
// Mark all pending entries as sent. (Real integration would dispatch via SMS/email service)
router.post('/:id/send', requirePermission(Permission.RECALL_MANAGE), async (req: Request, res: Response) => {
  try {
    // Verify campaign exists and belongs to this clinic
    const campaignResult = await query(
      `SELECT id, status, channel, message_template FROM recall_campaigns
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (campaignResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found' });
      return;
    }

    const campaign = campaignResult.rows[0];

    // Get all pending entries for this campaign, joining to patients for contact info
    const pendingEntries = await query(
      `SELECT re.id, re.patient_id, p.phone as contact_phone, p.email as contact_email
       FROM recall_entries re
       JOIN patients p ON re.patient_id = p.id
       WHERE re.campaign_id = $1 AND re.status = 'pending'`,
      [req.params.id]
    );

    let sent = 0;
    let failed = 0;

    for (const entry of pendingEntries.rows) {
      try {
        // Determine if patient has valid contact info for the channel
        const canSms = (campaign.channel === 'sms' || campaign.channel === 'both') && entry.contact_phone;
        const canEmail = (campaign.channel === 'email' || campaign.channel === 'both') && entry.contact_email;

        if (!canSms && !canEmail) {
          await query(
            `UPDATE recall_entries SET status = 'failed', response = 'No valid contact info', contacted_at = NOW()
             WHERE id = $1`,
            [entry.id]
          );
          failed++;
          continue;
        }

        // In a real integration, dispatch via SMS/email service here.
        // For now, mark as sent.
        await query(
          `UPDATE recall_entries SET status = 'sent', contacted_at = NOW()
           WHERE id = $1`,
          [entry.id]
        );
        sent++;
      } catch {
        await query(
          `UPDATE recall_entries SET status = 'failed', response = 'Send error', contacted_at = NOW()
           WHERE id = $1`,
          [entry.id]
        );
        failed++;
      }
    }

    // Update campaign status
    await query(
      `UPDATE recall_campaigns SET status = 'sent', updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.RECALL_SEND,
      resourceType: 'recall_campaign',
      resourceId: req.params.id,
      details: { sent, failed, total: pendingEntries.rows.length },
      req,
    });

    res.json({
      success: true,
      data: {
        totalProcessed: pendingEntries.rows.length,
        sent,
        failed,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── List entries for campaign ──
router.get('/:id/entries', requirePermission(Permission.RECALL_VIEW), async (req: Request, res: Response) => {
  try {
    const { status, page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    // Verify campaign exists and belongs to this clinic
    const campaignCheck = await query(
      `SELECT id FROM recall_campaigns WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (campaignCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found' });
      return;
    }

    let whereClause = 're.campaign_id = $1';
    const params: unknown[] = [req.params.id];

    if (status) {
      whereClause += ` AND re.status = $${params.length + 1}`;
      params.push(status);
    }

    const countResult = await query(
      `SELECT COUNT(*) as total FROM recall_entries re WHERE ${whereClause}`,
      params
    );

    const result = await query(
      `SELECT re.id, re.patient_id, re.status, re.contacted_at, re.response, re.created_at,
              p.first_name as patient_first_name, p.last_name as patient_last_name,
              p.mrn, p.phone as patient_phone, p.email as patient_email
       FROM recall_entries re
       JOIN patients p ON re.patient_id = p.id
       WHERE ${whereClause}
       ORDER BY p.last_name, p.first_name
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
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

export default router;
