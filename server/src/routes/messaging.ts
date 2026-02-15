import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query, transaction } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';
import { sendSms, isSmsConfigured, renderTemplate, normalizePhoneNumber } from '../services/sms';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Get SMS configuration status ──
router.get('/config', requirePermission(Permission.MESSAGING_VIEW), (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: { configured: isSmsConfigured() },
  });
});

// ── List conversations (patients with messages, grouped) ──
router.get('/conversations', requirePermission(Permission.MESSAGING_VIEW), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const search = (req.query.search as string) || '';

    let searchClause = '';
    const params: unknown[] = [clinicId];

    if (search) {
      params.push(`%${search}%`);
      searchClause = `AND (p.first_name ILIKE $2 OR p.last_name ILIKE $2 OR p.phone ILIKE $2)`;
    }

    const result = await query(
      `SELECT
        p.id as patient_id,
        p.first_name,
        p.last_name,
        p.phone,
        m.last_message_body,
        m.last_message_at,
        m.last_direction,
        m.unread_count,
        m.total_count
      FROM patients p
      INNER JOIN LATERAL (
        SELECT
          (SELECT body FROM sms_messages WHERE patient_id = p.id AND clinic_id = $1 ORDER BY created_at DESC LIMIT 1) as last_message_body,
          MAX(created_at) as last_message_at,
          (SELECT direction FROM sms_messages WHERE patient_id = p.id AND clinic_id = $1 ORDER BY created_at DESC LIMIT 1) as last_direction,
          COUNT(*) FILTER (WHERE direction = 'inbound' AND status = 'received') as unread_count,
          COUNT(*) as total_count
        FROM sms_messages
        WHERE patient_id = p.id AND clinic_id = $1
      ) m ON true
      WHERE p.clinic_id = $1 AND p.is_active = true AND m.total_count > 0
      ${searchClause}
      ORDER BY m.last_message_at DESC
      LIMIT 50`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Conversations error:', err);
    res.status(500).json({ success: false, error: 'Failed to load conversations' });
  }
});

// ── Get messages for a specific patient ──
router.get('/patient/:patientId', requirePermission(Permission.MESSAGING_VIEW), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const { patientId } = req.params;

    const result = await query(
      `SELECT m.*, u.first_name as sender_first, u.last_name as sender_last
       FROM sms_messages m
       LEFT JOIN users u ON m.sent_by = u.id
       WHERE m.clinic_id = $1 AND m.patient_id = $2
       ORDER BY m.created_at ASC`,
      [clinicId, patientId]
    );

    // Also get patient info
    const patientResult = await query(
      `SELECT id, first_name, last_name, phone, date_of_birth FROM patients WHERE id = $1 AND clinic_id = $2`,
      [patientId, clinicId]
    );

    res.json({
      success: true,
      data: {
        messages: result.rows,
        patient: patientResult.rows[0] || null,
      },
    });
  } catch (err) {
    console.error('Messages error:', err);
    res.status(500).json({ success: false, error: 'Failed to load messages' });
  }
});

// ── Send a message to a patient ──
const sendSchema = z.object({
  patientId: z.string().uuid(),
  body: z.string().min(1).max(1600),
  messageType: z.enum(['manual', 'reminder', 'birthday', 'follow_up', 'custom']).default('manual'),
});

router.post('/send', requirePermission(Permission.MESSAGING_SEND), async (req: Request, res: Response) => {
  try {
    const input = sendSchema.parse(req.body);
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;

    // Get patient phone
    const patientResult = await query(
      `SELECT id, phone, first_name, last_name FROM patients WHERE id = $1 AND clinic_id = $2`,
      [input.patientId, clinicId]
    );
    if (patientResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    const patient = patientResult.rows[0];
    if (!patient.phone) {
      res.status(400).json({ success: false, error: 'Patient has no phone number on file' });
      return;
    }

    const normalizedPhone = normalizePhoneNumber(patient.phone);
    if (!normalizedPhone) {
      res.status(400).json({ success: false, error: `Invalid phone number: ${patient.phone}` });
      return;
    }

    // Try to send via Twilio
    const smsResult = await sendSms(normalizedPhone, input.body);

    // Record the message regardless of send success
    const msgResult = await query(
      `INSERT INTO sms_messages (clinic_id, patient_id, direction, body, status, message_type, sent_by, to_number, from_number, external_id, error_message, sent_at)
       VALUES ($1, $2, 'outbound', $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        clinicId,
        input.patientId,
        'outbound',
        input.body,
        smsResult.success ? 'sent' : (isSmsConfigured() ? 'failed' : 'queued'),
        input.messageType,
        userId,
        normalizedPhone,
        isSmsConfigured() ? process.env.TWILIO_PHONE_NUMBER : null,
        smsResult.externalId || null,
        smsResult.error || null,
        smsResult.success ? new Date().toISOString() : null,
      ]
    );

    await logAudit({
      clinicId,
      userId,
      action: AuditAction.SMS_SEND,
      resourceType: 'sms_message',
      resourceId: msgResult.rows[0].id,
      details: {
        patientId: input.patientId,
        messageType: input.messageType,
        status: smsResult.success ? 'sent' : 'failed',
      },
      req,
    });

    res.json({
      success: true,
      data: {
        message: msgResult.rows[0],
        smsDelivered: smsResult.success,
        smsConfigured: isSmsConfigured(),
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    console.error('Send message error:', err);
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});

// ── Send bulk messages (reminders, birthdays) ──
const bulkSchema = z.object({
  type: z.enum(['reminder', 'birthday']),
  templateId: z.string().uuid().optional(),
  customBody: z.string().max(1600).optional(),
});

router.post('/send-bulk', requirePermission(Permission.MESSAGING_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = bulkSchema.parse(req.body);
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;

    // Get clinic info for templates
    const clinicResult = await query(`SELECT name, phone FROM clinics WHERE id = $1`, [clinicId]);
    const clinic = clinicResult.rows[0];

    let templateBody = input.customBody || '';

    if (input.templateId) {
      const tmplResult = await query(
        `SELECT body FROM sms_templates WHERE id = $1 AND clinic_id = $2`,
        [input.templateId, clinicId]
      );
      if (tmplResult.rows.length > 0) {
        templateBody = tmplResult.rows[0].body;
      }
    }

    if (!templateBody) {
      res.status(400).json({ success: false, error: 'No message body or template provided' });
      return;
    }

    let patients: any[] = [];

    if (input.type === 'reminder') {
      // Get patients with appointments tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().substring(0, 10);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);
      const dayAfterStr = dayAfter.toISOString().substring(0, 10);

      const result = await query(
        `SELECT DISTINCT p.id, p.first_name, p.last_name, p.phone,
                a.start_time
         FROM appointments a
         JOIN patients p ON a.patient_id = p.id
         WHERE a.clinic_id = $1
           AND a.status = 'scheduled'
           AND a.start_time >= $2
           AND a.start_time < $3
           AND p.phone IS NOT NULL
           AND p.is_active = true
         ORDER BY a.start_time`,
        [clinicId, `${tomorrowStr}T00:00:00Z`, `${dayAfterStr}T00:00:00Z`]
      );
      patients = result.rows;
    } else if (input.type === 'birthday') {
      // Get patients with birthdays today
      const today = new Date();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');

      const result = await query(
        `SELECT id, first_name, last_name, phone, date_of_birth
         FROM patients
         WHERE clinic_id = $1
           AND EXTRACT(MONTH FROM date_of_birth) = $2
           AND EXTRACT(DAY FROM date_of_birth) = $3
           AND phone IS NOT NULL
           AND is_active = true`,
        [clinicId, parseInt(month), parseInt(day)]
      );
      patients = result.rows;
    }

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    await transaction(async (client) => {
      for (const patient of patients) {
        const normalizedPhone = normalizePhoneNumber(patient.phone);
        if (!normalizedPhone) {
          failed++;
          errors.push(`${patient.first_name} ${patient.last_name}: invalid phone`);
          continue;
        }

        const context = {
          first_name: patient.first_name,
          last_name: patient.last_name,
          appointment_date: patient.start_time
            ? new Date(patient.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
            : '',
          appointment_time: patient.start_time
            ? new Date(patient.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : '',
          clinic_name: clinic.name,
          clinic_phone: clinic.phone,
        };

        const body = renderTemplate(templateBody, context);
        const smsResult = await sendSms(normalizedPhone, body);

        await client.query(
          `INSERT INTO sms_messages (clinic_id, patient_id, direction, body, status, message_type, sent_by, to_number, external_id, error_message, sent_at)
           VALUES ($1, $2, 'outbound', $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            clinicId, patient.id, body,
            smsResult.success ? 'sent' : (isSmsConfigured() ? 'failed' : 'queued'),
            input.type === 'reminder' ? 'reminder' : 'birthday',
            userId, normalizedPhone,
            smsResult.externalId || null, smsResult.error || null,
            smsResult.success ? new Date().toISOString() : null,
          ]
        );

        if (smsResult.success || !isSmsConfigured()) sent++;
        else { failed++; errors.push(`${patient.first_name} ${patient.last_name}: ${smsResult.error}`); }
      }
    });

    await logAudit({
      clinicId,
      userId,
      action: AuditAction.SMS_BULK_SEND,
      details: { type: input.type, total: patients.length, sent, failed },
      req,
    });

    res.json({
      success: true,
      data: {
        total: patients.length,
        sent,
        failed,
        errors: errors.slice(0, 10),
        smsConfigured: isSmsConfigured(),
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    console.error('Bulk send error:', err);
    res.status(500).json({ success: false, error: 'Failed to send messages' });
  }
});

// ── Templates CRUD ──
router.get('/templates', requirePermission(Permission.MESSAGING_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT t.*, u.first_name as creator_first, u.last_name as creator_last
       FROM sms_templates t
       LEFT JOIN users u ON t.created_by = u.id
       WHERE t.clinic_id = $1
       ORDER BY t.template_type, t.name`,
      [req.auth!.clinicId]
    );
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load templates' });
  }
});

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  body: z.string().min(1).max(1600),
  templateType: z.enum(['reminder', 'birthday', 'follow_up', 'custom']),
});

router.post('/templates', requirePermission(Permission.MESSAGING_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = templateSchema.parse(req.body);
    const result = await query(
      `INSERT INTO sms_templates (clinic_id, name, body, template_type, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.auth!.clinicId, input.name, input.body, input.templateType, req.auth!.userId]
    );
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.SMS_TEMPLATE_CREATE,
      resourceType: 'sms_template',
      resourceId: result.rows[0].id,
      req,
    });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create template' });
  }
});

router.put('/templates/:id', requirePermission(Permission.MESSAGING_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = templateSchema.parse(req.body);
    const result = await query(
      `UPDATE sms_templates SET name = $3, body = $4, template_type = $5 WHERE id = $1 AND clinic_id = $2 RETURNING *`,
      [req.params.id, req.auth!.clinicId, input.name, input.body, input.templateType]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.SMS_TEMPLATE_UPDATE,
      resourceType: 'sms_template',
      resourceId: req.params.id,
      req,
    });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update template' });
  }
});

router.delete('/templates/:id', requirePermission(Permission.MESSAGING_MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM sms_templates WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [req.params.id, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.SMS_TEMPLATE_DELETE,
      resourceType: 'sms_template',
      resourceId: req.params.id,
      req,
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to delete template' });
  }
});

// ── Twilio webhook for inbound messages ──
// NOTE: This endpoint does NOT use standard auth - it uses Twilio signature validation
router.post('/webhook/inbound', async (req: Request, res: Response) => {
  try {
    const { From, Body, MessageSid } = req.body;

    if (!From || !Body) {
      res.status(400).send('<Response></Response>');
      return;
    }

    // Find the patient by phone number across all clinics
    const normalized = normalizePhoneNumber(From);
    if (!normalized) {
      res.status(200).type('text/xml').send('<Response></Response>');
      return;
    }

    // Look for patients matching this phone number
    const result = await query(
      `SELECT p.id as patient_id, p.clinic_id, p.first_name, p.last_name
       FROM patients p
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(p.phone, '-', ''), '(', ''), ')', ''), ' ', '')
             LIKE '%' || $1
       AND p.is_active = true
       LIMIT 1`,
      [normalized.replace('+1', '')]
    );

    if (result.rows.length > 0) {
      const patient = result.rows[0];
      await query(
        `INSERT INTO sms_messages (clinic_id, patient_id, direction, body, status, message_type, from_number, external_id)
         VALUES ($1, $2, 'inbound', $3, 'received', 'manual', $4, $5)`,
        [patient.clinic_id, patient.patient_id, Body, From, MessageSid || null]
      );
    }

    // Respond with empty TwiML
    res.status(200).type('text/xml').send('<Response></Response>');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).type('text/xml').send('<Response></Response>');
  }
});

// ── Quick stats for messaging dashboard ──
router.get('/stats', requirePermission(Permission.MESSAGING_VIEW), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;

    const [totalResult, todayResult, unreadResult] = await Promise.all([
      query(`SELECT COUNT(*) as count FROM sms_messages WHERE clinic_id = $1`, [clinicId]),
      query(
        `SELECT COUNT(*) as count FROM sms_messages WHERE clinic_id = $1 AND created_at >= CURRENT_DATE`,
        [clinicId]
      ),
      query(
        `SELECT COUNT(*) as count FROM sms_messages WHERE clinic_id = $1 AND direction = 'inbound' AND status = 'received'`,
        [clinicId]
      ),
    ]);

    // Count patients with appointments tomorrow (for reminder button)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().substring(0, 10);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);
    const dayAfterStr = dayAfter.toISOString().substring(0, 10);

    const reminderResult = await query(
      `SELECT COUNT(DISTINCT p.id) as count
       FROM appointments a JOIN patients p ON a.patient_id = p.id
       WHERE a.clinic_id = $1 AND a.status = 'scheduled'
         AND a.start_time >= $2 AND a.start_time < $3
         AND p.phone IS NOT NULL AND p.is_active = true`,
      [clinicId, `${tomorrowStr}T00:00:00Z`, `${dayAfterStr}T00:00:00Z`]
    );

    // Count patients with birthdays today
    const today = new Date();
    const birthdayResult = await query(
      `SELECT COUNT(*) as count FROM patients
       WHERE clinic_id = $1 AND EXTRACT(MONTH FROM date_of_birth) = $2
         AND EXTRACT(DAY FROM date_of_birth) = $3 AND phone IS NOT NULL AND is_active = true`,
      [clinicId, today.getMonth() + 1, today.getDate()]
    );

    res.json({
      success: true,
      data: {
        totalMessages: parseInt(totalResult.rows[0].count),
        todayMessages: parseInt(todayResult.rows[0].count),
        unreadMessages: parseInt(unreadResult.rows[0].count),
        tomorrowReminders: parseInt(reminderResult.rows[0].count),
        todayBirthdays: parseInt(birthdayResult.rows[0].count),
      },
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

// ── Search patients for compose ──
router.get('/patients/search', requirePermission(Permission.MESSAGING_SEND), async (req: Request, res: Response) => {
  try {
    const search = (req.query.q as string) || '';
    if (search.length < 2) {
      res.json({ success: true, data: [] });
      return;
    }

    const result = await query(
      `SELECT id, first_name, last_name, phone, mrn
       FROM patients
       WHERE clinic_id = $1 AND is_active = true
         AND (first_name ILIKE $2 OR last_name ILIKE $2 OR phone ILIKE $2 OR mrn ILIKE $2)
       ORDER BY last_name, first_name
       LIMIT 20`,
      [req.auth!.clinicId, `%${search}%`]
    );

    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Search failed' });
  }
});

export default router;
