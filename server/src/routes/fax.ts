import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();

// ── Public webhook endpoint (no auth) ── must be registered before the auth middleware
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const {
      fax_number,
      from_number,
      pages,
      provider_message_id,
      clinic_id,
      subject,
    } = req.body;

    if (!from_number || !clinic_id) {
      res.status(400).json({ success: false, error: 'from_number and clinic_id are required' });
      return;
    }

    const result = await query(
      `INSERT INTO faxes (clinic_id, direction, fax_number, status, pages, subject, provider_message_id, received_at)
       VALUES ($1, 'inbound', $2, 'received', $3, $4, $5, NOW())
       RETURNING *`,
      [
        clinic_id,
        from_number,
        pages || null,
        subject || null,
        provider_message_id || null,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Fax webhook error:', err);
    res.status(500).json({ success: false, error: 'Failed to process inbound fax' });
  }
});

// ── Apply auth middleware to all remaining routes ──
router.use(authenticate, validateSession, tenantScope);

// ── Send a fax ──
const sendFaxSchema = z.object({
  fax_number: z.string().min(7).max(20),
  patient_id: z.string().uuid().optional(),
  document_type: z.string().min(1).max(50),
  note_id: z.string().uuid().optional(),
  attachment_id: z.string().uuid().optional(),
  subject: z.string().min(1).max(255),
});

router.post('/send', requirePermission(Permission.FAX_SEND), async (req: Request, res: Response) => {
  try {
    const input = sendFaxSchema.parse(req.body);
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;

    // If patient_id provided, verify it belongs to this clinic
    if (input.patient_id) {
      const patientCheck = await query(
        `SELECT id FROM patients WHERE id = $1 AND clinic_id = $2`,
        [input.patient_id, clinicId]
      );
      if (patientCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Patient not found' });
        return;
      }
    }

    // If note_id provided, verify it belongs to this clinic
    if (input.note_id) {
      const noteCheck = await query(
        `SELECT id FROM clinical_notes WHERE id = $1 AND clinic_id = $2`,
        [input.note_id, clinicId]
      );
      if (noteCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Clinical note not found' });
        return;
      }
    }

    // If attachment_id provided, verify it belongs to this clinic
    if (input.attachment_id) {
      const attachCheck = await query(
        `SELECT id FROM attachments WHERE id = $1 AND clinic_id = $2`,
        [input.attachment_id, clinicId]
      );
      if (attachCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Attachment not found' });
        return;
      }
    }

    const result = await query(
      `INSERT INTO faxes (clinic_id, patient_id, direction, fax_number, status, subject, document_type, note_id, attachment_id, sent_by)
       VALUES ($1, $2, 'outbound', $3, 'queued', $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        clinicId,
        input.patient_id || null,
        input.fax_number,
        input.subject,
        input.document_type,
        input.note_id || null,
        input.attachment_id || null,
        userId,
      ]
    );

    await logAudit({
      clinicId,
      userId,
      action: AuditAction.FAX_SEND,
      resourceType: 'fax',
      resourceId: result.rows[0].id,
      details: {
        fax_number: input.fax_number,
        document_type: input.document_type,
        patient_id: input.patient_id || null,
        note_id: input.note_id || null,
        attachment_id: input.attachment_id || null,
      },
      req,
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    console.error('Send fax error:', err);
    res.status(500).json({ success: false, error: 'Failed to send fax' });
  }
});

// ── List faxes ──
router.get('/', requirePermission(Permission.FAX_VIEW), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const conditions: string[] = ['f.clinic_id = $1'];
    const params: unknown[] = [clinicId];
    let paramIndex = 2;

    if (req.query.patient_id) {
      conditions.push(`f.patient_id = $${paramIndex++}`);
      params.push(req.query.patient_id);
    }

    if (req.query.direction) {
      conditions.push(`f.direction = $${paramIndex++}`);
      params.push(req.query.direction);
    }

    if (req.query.status) {
      conditions.push(`f.status = $${paramIndex++}`);
      params.push(req.query.status);
    }

    if (req.query.from_date) {
      conditions.push(`f.created_at >= $${paramIndex++}`);
      params.push(req.query.from_date);
    }

    if (req.query.to_date) {
      conditions.push(`f.created_at <= $${paramIndex++}`);
      params.push(req.query.to_date);
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) as total FROM faxes f WHERE ${where}`,
      params
    );

    const result = await query(
      `SELECT f.*,
              p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
              u.first_name as sender_first_name, u.last_name as sender_last_name
       FROM faxes f
       LEFT JOIN patients p ON f.patient_id = p.id
       LEFT JOIN users u ON f.sent_by = u.id
       WHERE ${where}
       ORDER BY f.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: result.rows,
      meta: {
        page,
        limit,
        total: parseInt(countResult.rows[0].total, 10),
      },
    });
  } catch (err) {
    console.error('List faxes error:', err);
    res.status(500).json({ success: false, error: 'Failed to list faxes' });
  }
});

// ── Get single fax ──
router.get('/:id', requirePermission(Permission.FAX_VIEW), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;

    const result = await query(
      `SELECT f.*,
              p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
              u.first_name as sender_first_name, u.last_name as sender_last_name
       FROM faxes f
       LEFT JOIN patients p ON f.patient_id = p.id
       LEFT JOIN users u ON f.sent_by = u.id
       WHERE f.id = $1 AND f.clinic_id = $2`,
      [req.params.id, clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Fax not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Get fax error:', err);
    res.status(500).json({ success: false, error: 'Failed to get fax' });
  }
});

// ── Update fax status (for webhook from fax provider) ──
const updateStatusSchema = z.object({
  status: z.enum(['queued', 'sending', 'sent', 'delivered', 'failed', 'received', 'filed']),
  provider_message_id: z.string().max(255).optional(),
  pages: z.number().int().positive().optional(),
  error_message: z.string().max(1000).optional(),
});

router.put('/:id/status', requirePermission(Permission.FAX_SEND), async (req: Request, res: Response) => {
  try {
    const input = updateStatusSchema.parse(req.body);
    const clinicId = req.auth!.clinicId;

    // Build dynamic SET clause
    const setClauses: string[] = ['status = $3'];
    const params: unknown[] = [req.params.id, clinicId, input.status];
    let paramIndex = 4;

    if (input.provider_message_id !== undefined) {
      setClauses.push(`provider_message_id = $${paramIndex++}`);
      params.push(input.provider_message_id);
    }

    if (input.pages !== undefined) {
      setClauses.push(`pages = $${paramIndex++}`);
      params.push(input.pages);
    }

    if (input.error_message !== undefined) {
      setClauses.push(`error_message = $${paramIndex++}`);
      params.push(input.error_message);
    }

    // Set sent_at when status transitions to sent/delivered
    if (input.status === 'sent' || input.status === 'delivered') {
      setClauses.push(`sent_at = COALESCE(sent_at, NOW())`);
    }

    // Set received_at when status transitions to received
    if (input.status === 'received') {
      setClauses.push(`received_at = COALESCE(received_at, NOW())`);
    }

    const result = await query(
      `UPDATE faxes SET ${setClauses.join(', ')}
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Fax not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    console.error('Update fax status error:', err);
    res.status(500).json({ success: false, error: 'Failed to update fax status' });
  }
});

// ── Quick fax to referring provider ──
const sendToProviderSchema = z.object({
  patient_id: z.string().uuid(),
  note_id: z.string().uuid(),
  referring_provider_id: z.string().uuid(),
});

router.post('/send-to-provider', requirePermission(Permission.FAX_SEND), async (req: Request, res: Response) => {
  try {
    const input = sendToProviderSchema.parse(req.body);
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;

    // Verify patient belongs to this clinic
    const patientResult = await query(
      `SELECT id, first_name, last_name FROM patients WHERE id = $1 AND clinic_id = $2`,
      [input.patient_id, clinicId]
    );
    if (patientResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    // Verify clinical note belongs to this clinic
    const noteResult = await query(
      `SELECT id, note_type FROM clinical_notes WHERE id = $1 AND clinic_id = $2`,
      [input.note_id, clinicId]
    );
    if (noteResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Clinical note not found' });
      return;
    }

    // Look up referring provider and their fax number
    const providerResult = await query(
      `SELECT id, first_name, last_name, fax, organization
       FROM referring_providers
       WHERE id = $1 AND clinic_id = $2 AND is_active = true`,
      [input.referring_provider_id, clinicId]
    );
    if (providerResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Referring provider not found' });
      return;
    }

    const provider = providerResult.rows[0];
    if (!provider.fax) {
      res.status(400).json({ success: false, error: 'Referring provider does not have a fax number on file' });
      return;
    }

    const patient = patientResult.rows[0];
    const note = noteResult.rows[0];
    const subject = `${note.note_type} - ${patient.first_name} ${patient.last_name}`;

    const result = await query(
      `INSERT INTO faxes (clinic_id, patient_id, direction, fax_number, status, subject, document_type, note_id, sent_by)
       VALUES ($1, $2, 'outbound', $3, 'queued', $4, $5, $6, $7)
       RETURNING *`,
      [
        clinicId,
        input.patient_id,
        provider.fax,
        subject,
        note.note_type,
        input.note_id,
        userId,
      ]
    );

    await logAudit({
      clinicId,
      userId,
      action: AuditAction.FAX_SEND,
      resourceType: 'fax',
      resourceId: result.rows[0].id,
      details: {
        referring_provider_id: input.referring_provider_id,
        referring_provider_name: `${provider.first_name} ${provider.last_name}`,
        patient_id: input.patient_id,
        note_id: input.note_id,
        fax_number: provider.fax,
      },
      req,
    });

    res.status(201).json({
      success: true,
      data: {
        fax: result.rows[0],
        provider: {
          id: provider.id,
          name: `${provider.first_name} ${provider.last_name}`,
          organization: provider.organization,
          fax: provider.fax,
        },
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    console.error('Send to provider error:', err);
    res.status(500).json({ success: false, error: 'Failed to send fax to provider' });
  }
});

export default router;
