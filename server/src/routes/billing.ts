import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction, ClaimStatus, LedgerEntryType } from '../types';
import { logAudit } from '../services/audit';
import { scrubClaim, generate837P, parseERA, postERAToLedger, runUnderpaymentDetectionForERA } from '../services/claims';
import { runCodeReview, getLatestCodeReview } from '../services/codeReview';
import { draftAppeal, getAppealDrafts, updateAppealDraft } from '../services/appealDraft';
import { LLMError } from '../services/llm';
import { checkKxModifier, updateCapTracking } from '../services/therapy-cap';
import {
  scoreClaimRisk,
  relearnClinicPatterns,
  getClinicSetting,
  setClinicSetting,
  CONTRIBUTE_SETTING_KEY,
  riskBand,
} from '../services/denialPatterns';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Ledger ──
router.get('/ledger/:patientId', requirePermission(Permission.LEDGER_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT le.*, u.first_name as posted_by_first_name, u.last_name as posted_by_last_name
       FROM ledger_entries le
       JOIN users u ON le.posted_by = u.id
       WHERE le.clinic_id = $1 AND le.patient_id = $2
       ORDER BY le.posted_at DESC`,
      [req.auth!.clinicId, req.params.patientId]
    );

    // Calculate balance
    let balance = 0;
    for (const entry of result.rows) {
      if (entry.entry_type === 'charge') balance += entry.amount_cents;
      else balance -= entry.amount_cents;
    }

    res.json({
      success: true,
      data: { entries: result.rows, balanceCents: balance },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Create ledger entry
router.post('/ledger', requirePermission(Permission.LEDGER_EDIT), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      patientId: z.string().uuid(),
      claimId: z.string().uuid().optional().nullable(),
      entryType: z.nativeEnum(LedgerEntryType),
      amountCents: z.number().int().positive(),
      description: z.string().min(1),
      cptCode: z.string().optional().nullable(),
      serviceDate: z.string().optional().nullable(),
      payerName: z.string().optional().nullable(),
      checkNumber: z.string().optional().nullable(),
    });
    const input = schema.parse(req.body);

    const result = await query(
      `INSERT INTO ledger_entries (clinic_id, patient_id, claim_id, entry_type, amount_cents, description, cpt_code, service_date, payer_name, check_number, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        req.auth!.clinicId, input.patientId, input.claimId || null,
        input.entryType, input.amountCents, input.description,
        input.cptCode || null, input.serviceDate || null,
        input.payerName || null, input.checkNumber || null,
        req.auth!.userId,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.LEDGER_CREATE,
      resourceType: 'ledger_entry',
      resourceId: result.rows[0].id,
      details: { entryType: input.entryType, amountCents: input.amountCents },
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

// ── Claims ──
router.get('/claims', requirePermission(Permission.CLAIM_VIEW), async (req: Request, res: Response) => {
  try {
    const { status, patientId, page = '1', limit = '25' } = req.query;
    const conditions: string[] = ['c.clinic_id = $1'];
    const params: unknown[] = [req.auth!.clinicId];
    let idx = 2;

    if (status) {
      conditions.push(`c.status = $${idx++}`);
      params.push(status);
    }
    if (patientId) {
      conditions.push(`c.patient_id = $${idx++}`);
      params.push(patientId);
    }

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, parseInt(limit as string, 10));

    const countResult = await query(
      `SELECT COUNT(*) as total FROM claims c WHERE ${conditions.join(' AND ')}`,
      params
    );

    const result = await query(
      `SELECT c.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
       FROM claims c
       JOIN patients p ON c.patient_id = p.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limitNum, (pageNum - 1) * limitNum]
    );

    res.json({
      success: true,
      data: result.rows,
      meta: { page: pageNum, limit: limitNum, total: parseInt(countResult.rows[0].total, 10) },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Create claim from appointment/note
router.post('/claims', requirePermission(Permission.BILLING_CREATE), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      patientId: z.string().uuid(),
      appointmentId: z.string().uuid().optional().nullable(),
      noteId: z.string().uuid().optional().nullable(),
      insuranceId: z.string().uuid().optional().nullable(),
      serviceDate: z.string(),
      billingProviderNpi: z.string().length(10),
      renderingProviderNpi: z.string().length(10),
      diagnosisCodes: z.array(z.string()).min(1),
      lineItems: z.array(z.object({
        lineNumber: z.number(),
        cptCode: z.string(),
        modifiers: z.array(z.string()).optional().default([]),
        diagnosisPointers: z.array(z.number()).min(1),
        units: z.number().positive(),
        chargeCents: z.number().positive(),
      })),
    });
    const input = schema.parse(req.body);

    const totalChargeCents = input.lineItems.reduce((sum, item) => sum + item.chargeCents * item.units, 0);
    const claimNumber = `CLM-${Date.now().toString(36).toUpperCase()}`;

    const lineItemsForDb = input.lineItems.map(item => ({
      line_number: item.lineNumber,
      cpt_code: item.cptCode,
      modifiers: item.modifiers,
      diagnosis_pointers: item.diagnosisPointers,
      units: item.units,
      charge_cents: item.chargeCents,
      paid_cents: 0,
      adjustment_cents: 0,
      denial_reason: null,
    }));

    const result = await query(
      `INSERT INTO claims (clinic_id, patient_id, appointment_id, note_id, insurance_id, service_date,
        billing_provider_npi, rendering_provider_npi, diagnosis_codes, line_items,
        total_charge_cents, claim_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        req.auth!.clinicId, input.patientId, input.appointmentId || null,
        input.noteId || null, input.insuranceId || null, input.serviceDate,
        input.billingProviderNpi, input.renderingProviderNpi,
        input.diagnosisCodes, JSON.stringify(lineItemsForDb),
        totalChargeCents, claimNumber,
      ]
    );

    // Auto-post charges to ledger
    for (const item of input.lineItems) {
      await query(
        `INSERT INTO ledger_entries (clinic_id, patient_id, claim_id, entry_type, amount_cents, description, cpt_code, service_date, posted_by)
         VALUES ($1,$2,$3,'charge',$4,$5,$6,$7,$8)`,
        [
          req.auth!.clinicId, input.patientId, result.rows[0].id,
          item.chargeCents * item.units,
          `Charge: ${item.cptCode} x${item.units}`,
          item.cptCode,
          input.serviceDate,
          req.auth!.userId,
        ]
      );
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.CLAIM_CREATE,
      resourceType: 'claim',
      resourceId: result.rows[0].id,
      details: { claimNumber, totalChargeCents },
      req,
    });

    // Check Medicare therapy cap / KX modifier requirement
    const serviceYear = new Date(input.serviceDate).getFullYear();
    const capCheck = await checkKxModifier(req.auth!.clinicId, input.patientId, serviceYear);
    // Update cap tracking with this claim's charges
    await updateCapTracking(req.auth!.clinicId, input.patientId, serviceYear, totalChargeCents, 0);

    const kxWarnings: string[] = [];
    if (capCheck.kxRequired) {
      const hasKx = input.lineItems.some(item =>
        (item.modifiers || []).some(m => m.toUpperCase() === 'KX')
      );
      if (!hasKx) {
        kxWarnings.push('Medicare therapy cap reached — KX modifier required on line items');
      }
    }

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        claimNumber,
        kxRequired: capCheck.kxRequired,
        warnings: kxWarnings,
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

// Scrub claim
router.post('/claims/:id/scrub', requirePermission(Permission.CLAIM_SUBMIT), async (req: Request, res: Response) => {
  try {
    const claimResult = await query(
      'SELECT * FROM claims WHERE id = $1 AND clinic_id = $2',
      [req.params.id, req.auth!.clinicId]
    );
    if (claimResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Claim not found' });
      return;
    }

    const claim = claimResult.rows[0];
    const result = scrubClaim(claim);

    const newStatus = result.passed ? ClaimStatus.SCRUBBED : ClaimStatus.SCRUB_FAILED;
    await query(
      `UPDATE claims SET status = $3, scrub_errors = $4 WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId, newStatus, result.errors]
    );

    res.json({ success: true, data: { ...result, status: newStatus } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Export 837P
router.get('/claims/:id/837p', requirePermission(Permission.BILLING_EXPORT), async (req: Request, res: Response) => {
  try {
    const ediContent = await generate837P(req.params.id, req.auth!.clinicId);

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.CLAIM_SUBMIT,
      resourceType: 'claim',
      resourceId: req.params.id,
      details: { format: '837P' },
      req,
    });

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="837P_${req.params.id}.edi"`);
    res.send(ediContent);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Update claim status
router.patch('/claims/:id/status', requirePermission(Permission.CLAIM_SUBMIT), async (req: Request, res: Response) => {
  try {
    const { status } = z.object({ status: z.nativeEnum(ClaimStatus) }).parse(req.body);
    const result = await query(
      `UPDATE claims SET status = $3, submitted_at = CASE WHEN $3 = 'submitted' THEN NOW() ELSE submitted_at END
       WHERE id = $1 AND clinic_id = $2 RETURNING id, status`,
      [req.params.id, req.auth!.clinicId, status]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Claim not found' });
      return;
    }
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.CLAIM_EDIT,
      resourceType: 'claim',
      resourceId: req.params.id,
      details: { newStatus: status },
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

// ── ERA Import ──
router.post('/era/import', requirePermission(Permission.ERA_IMPORT), async (req: Request, res: Response) => {
  try {
    const { filename, content } = z.object({
      filename: z.string(),
      content: z.string(),
    }).parse(req.body);

    const parsed = parseERA(content);

    const result = await query(
      `INSERT INTO era_files (clinic_id, filename, raw_content, check_number, check_date, payer_name, total_paid_cents, claims_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        req.auth!.clinicId, filename, content,
        parsed.checkNumber, parsed.checkDate || null,
        parsed.payerName, Math.round(parsed.totalPaid),
        parsed.claims.length,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.ERA_IMPORT,
      resourceType: 'era_file',
      resourceId: result.rows[0].id,
      details: { claimsCount: parsed.claims.length, totalPaidCents: Math.round(parsed.totalPaid) },
      req,
    });

    res.status(201).json({ success: true, data: { id: result.rows[0].id, parsed } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Post ERA to ledger
router.post('/era/:id/post', requirePermission(Permission.ERA_IMPORT), async (req: Request, res: Response) => {
  try {
    const result = await postERAToLedger(req.params.id, req.auth!.clinicId, req.auth!.userId);

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.ERA_POST,
      resourceType: 'era_file',
      resourceId: req.params.id,
      details: { postedCount: result.posted },
      req,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ERA exceptions — classify each line item as auto-postable or an exception.
// Read-only: does NOT change existing /era/:id/post behavior.
router.get('/era/:id/exceptions', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    const eraResult = await query(
      `SELECT * FROM era_files WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (eraResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'ERA file not found' });
      return;
    }

    const parsed = parseERA(eraResult.rows[0].raw_content);

    const autoPostable: Array<{
      claimNumber: string;
      cptCode: string;
      billed_cents: number;
      paid_cents: number;
      reason: null;
    }> = [];
    const exceptions: Array<{
      claimNumber: string;
      cptCode: string;
      billed_cents: number;
      paid_cents: number;
      reason: 'underpaid' | 'denied' | 'adjusted';
    }> = [];

    for (const claim of parsed.claims) {
      for (const item of claim.lineItems) {
        if (
          item.paidAmount === item.chargeAmount &&
          item.adjustmentAmount === 0 &&
          !item.denialReason
        ) {
          autoPostable.push({
            claimNumber: claim.claimNumber,
            cptCode: item.cptCode,
            billed_cents: Math.round(item.chargeAmount),
            paid_cents: Math.round(item.paidAmount),
            reason: null,
          });
        } else {
          let reason: 'underpaid' | 'denied' | 'adjusted';
          if (item.paidAmount === 0 && (item.denialReason || item.adjustmentAmount > 0)) {
            reason = 'denied';
          } else if (item.paidAmount > 0 && item.paidAmount < item.chargeAmount) {
            reason = 'underpaid';
          } else {
            reason = 'adjusted';
          }
          exceptions.push({
            claimNumber: claim.claimNumber,
            cptCode: item.cptCode,
            billed_cents: Math.round(item.chargeAmount),
            paid_cents: Math.round(item.paidAmount),
            reason,
          });
        }
      }
    }

    res.json({
      success: true,
      data: {
        eraId: req.params.id,
        autoPostable,
        exceptions,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── A/R Aging Report ──
router.get('/reports/ar-aging', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT 
        c.id, c.claim_number, c.service_date, c.status,
        c.total_charge_cents, c.total_paid_cents, c.total_adjustment_cents,
        (c.total_charge_cents - c.total_paid_cents - c.total_adjustment_cents) as balance_cents,
        p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
        EXTRACT(DAY FROM NOW() - c.service_date::timestamp) as days_old
       FROM claims c
       JOIN patients p ON c.patient_id = p.id
       WHERE c.clinic_id = $1
         AND c.status NOT IN ('paid', 'denied')
         AND (c.total_charge_cents - c.total_paid_cents - c.total_adjustment_cents) > 0
       ORDER BY c.service_date ASC`,
      [req.auth!.clinicId]
    );

    // Group by aging buckets
    const buckets = { current: [] as unknown[], days30: [] as unknown[], days60: [] as unknown[], days90: [] as unknown[], days120plus: [] as unknown[] };
    for (const row of result.rows) {
      const days = parseInt(row.days_old, 10);
      if (days <= 30) buckets.current.push(row);
      else if (days <= 60) buckets.days30.push(row);
      else if (days <= 90) buckets.days60.push(row);
      else if (days <= 120) buckets.days90.push(row);
      else buckets.days120plus.push(row);
    }

    res.json({ success: true, data: { buckets, totalClaims: result.rows.length } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Documentation-to-code review (AI billing Phase 3) ──

// Run an LLM-assisted review comparing a claim's CPTs against its clinical note.
router.post('/claims/:id/code-review', requirePermission(Permission.CLAIM_SUBMIT), async (req: Request, res: Response) => {
  try {
    const result = await runCodeReview(req.params.id, req.auth!.clinicId, req.auth!.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof LLMError) {
      const status = err.statusCode;
      // 503 = LLM not configured; surface the setup hint. Never leak note text.
      res.status(status).json({ success: false, error: err.message, llmRequired: status === 503 });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Latest stored review for a claim (no LLM call).
router.get('/claims/:id/code-review', requirePermission(Permission.CLAIM_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await getLatestCodeReview(req.params.id, req.auth!.clinicId);
    if (!result) {
      res.status(404).json({ success: false, error: 'No code review found for this claim' });
      return;
    }
    res.json({ success: true, data: result });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Denial appeal drafts (AI billing Phase 4) ──

// Draft an LLM-assisted appeal letter for a denied claim.
router.post('/claims/:id/appeal-draft', requirePermission(Permission.CLAIM_SUBMIT), async (req: Request, res: Response) => {
  try {
    const result = await draftAppeal(req.params.id, req.auth!.clinicId, req.auth!.userId, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err instanceof LLMError) {
      const status = err.statusCode;
      // 503 = LLM not configured; surface the setup hint. Never leak note text.
      res.status(status).json({ success: false, error: err.message, llmRequired: status === 503 });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// List appeal drafts for a claim, newest first (no LLM call).
router.get('/claims/:id/appeal-drafts', requirePermission(Permission.CLAIM_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await getAppealDrafts(req.params.id, req.auth!.clinicId);
    res.json({ success: true, data: result });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Edit draft text and/or advance status (draft -> edited -> sent).
router.put('/appeal-drafts/:id', requirePermission(Permission.CLAIM_SUBMIT), async (req: Request, res: Response) => {
  try {
    const result = await updateAppealDraft(req.params.id, req.auth!.clinicId, req.auth!.userId, req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof LLMError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Fee Schedules & Underpayment Detection (AI billing Phase 1) ──

const feeScheduleSchema = z.object({
  name: z.string().min(1).max(255),
  payer_name: z.string().max(255).optional().nullable(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().nullable(),
  is_active: z.boolean().optional(),
});

const feeScheduleItemSchema = z.object({
  cpt_code: z.string().min(1).max(20),
  allowed_amount_cents: z.number().int().min(0).max(100000000),
  notes: z.string().max(500).optional().nullable(),
});

// List fee schedules with item counts
router.get('/fee-schedules', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT fs.*, COUNT(fsi.id)::int AS item_count
       FROM fee_schedules fs
       LEFT JOIN fee_schedule_items fsi ON fsi.schedule_id = fs.id
       WHERE fs.clinic_id = $1
       GROUP BY fs.id
       ORDER BY fs.payer_name NULLS FIRST, fs.name`,
      [req.auth!.clinicId]
    );
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Create fee schedule
router.post('/fee-schedules', requirePermission(Permission.BILLING_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = feeScheduleSchema.parse(req.body);
    const payerName = input.payer_name?.trim() || null;
    const result = await query(
      `INSERT INTO fee_schedules (clinic_id, payer_name, name, effective_date, is_active)
       VALUES ($1, $2, $3, $4, COALESCE($5, true))
       RETURNING *`,
      [req.auth!.clinicId, payerName, input.name.trim(), input.effective_date || null, input.is_active]
    );
    await logAudit({
      clinicId: req.auth!.clinicId, userId: req.auth!.userId,
      action: AuditAction.FEE_SCHEDULE_CREATE, resourceType: 'fee_schedule',
      resourceId: result.rows[0].id, details: { name: input.name, payer_name: payerName }, req,
    });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    const msg = (err as Error).message || '';
    if (msg.includes('uq_fee_schedules')) {
      res.status(409).json({ success: false, error: 'A fee schedule for this payer already exists (or a default schedule already exists)' });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get one schedule with items
router.get('/fee-schedules/:id', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    const sched = await query(
      `SELECT * FROM fee_schedules WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (sched.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Fee schedule not found' });
      return;
    }
    const items = await query(
      `SELECT * FROM fee_schedule_items WHERE schedule_id = $1 ORDER BY cpt_code`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...sched.rows[0], items: items.rows } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Update fee schedule
router.put('/fee-schedules/:id', requirePermission(Permission.BILLING_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = feeScheduleSchema.partial().parse(req.body);
    const payerName = input.payer_name === undefined ? undefined : (input.payer_name?.trim() || null);
    const result = await query(
      `UPDATE fee_schedules SET
         name = COALESCE($3, name),
         payer_name = COALESCE($4, payer_name),
         effective_date = COALESCE($5, effective_date),
         is_active = COALESCE($6, is_active),
         updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      [req.params.id, req.auth!.clinicId, input.name?.trim() ?? null, payerName ?? null,
       input.effective_date ?? null, input.is_active ?? null]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Fee schedule not found' });
      return;
    }
    await logAudit({
      clinicId: req.auth!.clinicId, userId: req.auth!.userId,
      action: AuditAction.FEE_SCHEDULE_EDIT, resourceType: 'fee_schedule',
      resourceId: req.params.id, details: input, req,
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

// Delete fee schedule (items cascade)
router.delete('/fee-schedules/:id', requirePermission(Permission.BILLING_MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM fee_schedules WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [req.params.id, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Fee schedule not found' });
      return;
    }
    await logAudit({
      clinicId: req.auth!.clinicId, userId: req.auth!.userId,
      action: AuditAction.FEE_SCHEDULE_DELETE, resourceType: 'fee_schedule',
      resourceId: req.params.id, details: {}, req,
    });
    res.json({ success: true, data: { id: req.params.id } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Upsert a rate item (add or update by CPT)
router.post('/fee-schedules/:id/items', requirePermission(Permission.BILLING_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = feeScheduleItemSchema.parse(req.body);
    const sched = await query(
      `SELECT id FROM fee_schedules WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (sched.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Fee schedule not found' });
      return;
    }
    const result = await query(
      `INSERT INTO fee_schedule_items (schedule_id, cpt_code, allowed_amount_cents, notes)
       VALUES ($1, UPPER(TRIM($2)), $3, $4)
       ON CONFLICT (schedule_id, cpt_code)
       DO UPDATE SET allowed_amount_cents = EXCLUDED.allowed_amount_cents,
                     notes = EXCLUDED.notes, updated_at = NOW()
       RETURNING *`,
      [req.params.id, input.cpt_code, input.allowed_amount_cents, input.notes ?? null]
    );
    await logAudit({
      clinicId: req.auth!.clinicId, userId: req.auth!.userId,
      action: AuditAction.FEE_SCHEDULE_EDIT, resourceType: 'fee_schedule',
      resourceId: req.params.id,
      details: { cpt_code: input.cpt_code.toUpperCase().trim(), allowed_amount_cents: input.allowed_amount_cents }, req,
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

// Delete a rate item
router.delete('/fee-schedules/:id/items/:itemId', requirePermission(Permission.BILLING_MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM fee_schedule_items
       WHERE id = $1 AND schedule_id IN (SELECT id FROM fee_schedules WHERE id = $2 AND clinic_id = $3)
       RETURNING id`,
      [req.params.itemId, req.params.id, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Rate not found' });
      return;
    }
    res.json({ success: true, data: { id: req.params.itemId } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Underpayment review queue ──

const underpaymentStatusSchema = z.object({
  status: z.enum(['open', 'in_review', 'appealed', 'resolved', 'wont_pursue']),
  notes: z.string().max(2000).optional().nullable(),
});

// Queue summary stats
router.get('/underpayments/summary', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(shortfall_cents), 0)::int AS shortfall_cents
       FROM underpayment_flags WHERE clinic_id = $1 GROUP BY status`,
      [req.auth!.clinicId]
    );
    const byStatus: Record<string, { count: number; shortfall_cents: number }> = {};
    for (const row of result.rows) byStatus[row.status] = { count: row.count, shortfall_cents: row.shortfall_cents };
    const open = byStatus.open ?? { count: 0, shortfall_cents: 0 };
    res.json({ success: true, data: { byStatus, openCount: open.count, openShortfallCents: open.shortfall_cents } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// List flags (optional ?status= filter)
router.get('/underpayments', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const params: unknown[] = [req.auth!.clinicId];
    let where = `uf.clinic_id = $1`;
    if (status && ['open', 'in_review', 'appealed', 'resolved', 'wont_pursue'].includes(status)) {
      params.push(status);
      where += ` AND uf.status = $2`;
    }
    const result = await query(
      `SELECT uf.*, c.claim_number, c.service_date,
              p.first_name AS patient_first_name, p.last_name AS patient_last_name, p.id AS patient_id,
              i.payer_name
       FROM underpayment_flags uf
       JOIN claims c ON c.id = uf.claim_id
       JOIN patients p ON p.id = c.patient_id
       LEFT JOIN insurance i ON i.id = c.insurance_id
       WHERE ${where}
       ORDER BY uf.shortfall_cents DESC`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Update flag status / notes
router.put('/underpayments/:id', requirePermission(Permission.BILLING_EDIT), async (req: Request, res: Response) => {
  try {
    const input = underpaymentStatusSchema.parse(req.body);
    const result = await query(
      `UPDATE underpayment_flags
       SET status = $3, notes = COALESCE($4, notes), updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      [req.params.id, req.auth!.clinicId, input.status, input.notes ?? null]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Underpayment flag not found' });
      return;
    }
    await logAudit({
      clinicId: req.auth!.clinicId, userId: req.auth!.userId,
      action: AuditAction.UNDERPAYMENT_REVIEW, resourceType: 'underpayment_flag',
      resourceId: req.params.id, details: { status: input.status }, req,
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

// Manual / historical detection run: re-parse posted ERAs and detect
router.post('/underpayments/run', requirePermission(Permission.BILLING_EDIT), async (req: Request, res: Response) => {
  try {
    const schema = z.object({ era_id: z.string().uuid().optional() });
    const input = schema.parse(req.body);
    let eraIds: string[];
    if (input.era_id) {
      eraIds = [input.era_id];
    } else {
      const eras = await query(
        `SELECT id FROM era_files WHERE clinic_id = $1 AND posted = true ORDER BY posted_at DESC`,
        [req.auth!.clinicId]
      );
      eraIds = eras.rows.map((r: { id: string }) => r.id);
    }
    let flagged = 0;
    let updated = 0;
    const missingRateLines: Array<{ claimId: string; cptCode: string }> = [];
    for (const eraId of eraIds) {
      const detection = await runUnderpaymentDetectionForERA(req.auth!.clinicId, eraId);
      flagged += detection.flagged;
      updated += detection.updated;
      missingRateLines.push(...detection.skippedMissingRate);
    }
    await logAudit({
      clinicId: req.auth!.clinicId, userId: req.auth!.userId,
      action: AuditAction.UNDERPAYMENT_REVIEW, resourceType: 'underpayment_detection',
      resourceId: input.era_id ?? 'all-posted',
      details: { flagged, updated, missingRates: missingRateLines.length }, req,
    });
    res.json({
      success: true,
      data: { erasScanned: eraIds.length, flagged, updated, missingRates: missingRateLines.length },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: (err as Error).message || 'Internal server error' });
  }
});

// ── Underpayment threshold setting ──

router.get('/settings/underpayment-threshold', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    const { getThresholdCents } = await import('../services/underpayment');
    const cents = await getThresholdCents(req.auth!.clinicId);
    res.json({ success: true, data: { threshold_cents: cents } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.put('/settings/underpayment-threshold', requirePermission(Permission.BILLING_MANAGE), async (req: Request, res: Response) => {
  try {
    const input = z.object({ threshold_cents: z.number().int().min(0).max(100000) }).parse(req.body);
    const { setThresholdCents } = await import('../services/underpayment');
    await setThresholdCents(req.auth!.clinicId, input.threshold_cents);
    res.json({ success: true, data: { threshold_cents: input.threshold_cents } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


// ── Denial Pattern Mining (AI billing Phase 2) ──

// List learned denial patterns. Sample sizes are always returned alongside
// rates — never present a rate without its sample size.
router.get('/denial-patterns', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      payer: z.string().optional(),
      minRate: z.coerce.number().min(0).max(1).optional(),
      minSamples: z.coerce.number().int().min(0).optional(),
      scope: z.enum(['clinic', 'global', 'all']).optional().default('clinic'),
    });
    const q = schema.parse(req.query);
    const clinicId = req.auth!.clinicId;

    const conds: string[] = [];
    const params: any[] = [];
    if (q.scope === 'all') {
      conds.push(`(scope = 'global' OR (scope = 'clinic' AND clinic_id = $${params.length + 1}))`);
      params.push(clinicId);
    } else if (q.scope === 'clinic') {
      conds.push(`scope = 'clinic' AND clinic_id = $${params.length + 1}`);
      params.push(clinicId);
    } else {
      conds.push(`scope = 'global'`);
    }
    if (q.payer) {
      conds.push(`payer_name ILIKE $${params.length + 1}`);
      params.push(`%${q.payer}%`);
    }
    if (q.minRate !== undefined) {
      conds.push(`denial_rate >= $${params.length + 1}`);
      params.push(q.minRate);
    }
    if (q.minSamples !== undefined) {
      conds.push(`total_lines >= $${params.length + 1}`);
      params.push(q.minSamples);
    }

    const result = await query(
      `SELECT id, scope, payer_name, cpt_code, diagnosis_code, reason_code,
              total_lines, denied_lines, denial_rate, contributing_clinics,
              last_seen_at, updated_at
       FROM denial_patterns
       WHERE ${conds.join(' AND ')}
       ORDER BY denial_rate DESC, total_lines DESC
       LIMIT 500`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input' });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Pre-submission denial risk score for a claim.
router.get('/claims/:id/denial-risk', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    const risk = await scoreClaimRisk(req.params.id, req.auth!.clinicId);
    res.json({ success: true, data: risk });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Rebuild clinic patterns from all posted ERAs. Uses ERA_IMPORT (not a new
// BILLING_MANAGE permission) to avoid conflicting with unpushed Phase 1 work
// that defines BILLING_MANAGE; ERA_IMPORT holders already manage ERA data.
router.post('/denial-patterns/relearn', requirePermission(Permission.ERA_IMPORT), async (req: Request, res: Response) => {
  try {
    const result = await relearnClinicPatterns(req.auth!.clinicId);
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.DENIAL_PATTERNS_RELEARN,
      resourceType: 'denial_patterns',
      resourceId: req.auth!.clinicId,
      details: result,
      req,
    });
    res.json({ success: true, data: result });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Cross-clinic contribution opt-in flag (default false). The aggregation
// pipeline is a future build; this flag just records consent now.
router.get('/denial-patterns/contribute', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    const value = await getClinicSetting(req.auth!.clinicId, CONTRIBUTE_SETTING_KEY, 'false');
    res.json({ success: true, data: { enabled: value === 'true' } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.put('/denial-patterns/contribute', requirePermission(Permission.SETTINGS_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = z.object({ enabled: z.boolean() });
    const input = schema.parse(req.body);
    await setClinicSetting(req.auth!.clinicId, CONTRIBUTE_SETTING_KEY, input.enabled ? 'true' : 'false');
    res.json({ success: true, data: { enabled: input.enabled } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input' });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


export default router;
