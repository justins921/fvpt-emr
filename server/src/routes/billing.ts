import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction, ClaimStatus, LedgerEntryType } from '../types';
import { logAudit } from '../services/audit';
import { scrubClaim, generate837P, parseERA, postERAToLedger } from '../services/claims';

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

    res.status(201).json({ success: true, data: { id: result.rows[0].id, claimNumber } });
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

export default router;
