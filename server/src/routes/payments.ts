import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Store Payment Method ──
router.post('/methods', requirePermission(Permission.PAYMENT_PROCESS), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      patient_id: z.string().uuid(),
      type: z.enum(['credit', 'debit', 'ach']),
      brand: z.string().min(1).max(50),
      last_four: z.string().length(4),
      exp_month: z.number().int().min(1).max(12),
      exp_year: z.number().int().min(2024).max(2099),
      processor_token: z.string().min(1),
      is_default: z.boolean().optional().default(false),
    });
    const input = schema.parse(req.body);

    // Verify patient belongs to this clinic
    const patientCheck = await query(
      `SELECT id FROM patients WHERE id = $1 AND clinic_id = $2`,
      [input.patient_id, req.auth!.clinicId]
    );
    if (patientCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    // If this is the default, unset existing defaults for this patient
    if (input.is_default) {
      await query(
        `UPDATE payment_methods SET is_default = false
         WHERE clinic_id = $1 AND patient_id = $2 AND is_default = true`,
        [req.auth!.clinicId, input.patient_id]
      );
    }

    const result = await query(
      `INSERT INTO payment_methods (clinic_id, patient_id, type, brand, last_four, exp_month, exp_year, processor_token, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        req.auth!.clinicId,
        input.patient_id,
        input.type,
        input.brand,
        input.last_four,
        input.exp_month,
        input.exp_year,
        input.processor_token,
        input.is_default,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.PAYMENT_PROCESS,
      resourceType: 'payment_method',
      resourceId: result.rows[0].id,
      details: { patient_id: input.patient_id, type: input.type, last_four: input.last_four },
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

// ── List Payment Methods for a Patient ──
router.get('/methods/:patientId', requirePermission(Permission.PAYMENT_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, patient_id, type, brand, last_four, exp_month, exp_year, is_default, is_active, created_at
       FROM payment_methods
       WHERE clinic_id = $1 AND patient_id = $2 AND is_active = true
       ORDER BY is_default DESC, created_at DESC`,
      [req.auth!.clinicId, req.params.patientId]
    );

    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Deactivate Payment Method ──
router.delete('/methods/:id', requirePermission(Permission.PAYMENT_PROCESS), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE payment_methods SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING id`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Payment method not found' });
      return;
    }

    res.json({ success: true, data: { id: req.params.id, is_active: false } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Process a Payment (Charge) ──
router.post('/charge', requirePermission(Permission.PAYMENT_PROCESS), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      patient_id: z.string().uuid(),
      payment_method_id: z.string().uuid(),
      amount_cents: z.number().int().positive(),
      description: z.string().min(1).max(500),
    });
    const input = schema.parse(req.body);

    // Verify payment method belongs to this patient and clinic
    const methodResult = await query(
      `SELECT id, processor_token, last_four, brand
       FROM payment_methods
       WHERE id = $1 AND clinic_id = $2 AND patient_id = $3 AND is_active = true`,
      [input.payment_method_id, req.auth!.clinicId, input.patient_id]
    );

    if (methodResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Payment method not found or inactive' });
      return;
    }

    const method = methodResult.rows[0];

    // Create payment transaction record
    const txnResult = await query(
      `INSERT INTO payment_transactions (clinic_id, patient_id, payment_method_id, amount_cents, description, processor_transaction_id, status, processed_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7)
       RETURNING id`,
      [
        req.auth!.clinicId,
        input.patient_id,
        input.payment_method_id,
        input.amount_cents,
        input.description,
        method.processor_token,
        req.auth!.userId,
      ]
    );

    const transactionId = txnResult.rows[0].id;

    // Create corresponding ledger entry
    await query(
      `INSERT INTO ledger_entries (clinic_id, patient_id, entry_type, amount_cents, description, posted_by)
       VALUES ($1, $2, 'payment', $3, $4, $5)`,
      [
        req.auth!.clinicId,
        input.patient_id,
        input.amount_cents,
        `Card payment (${method.brand} ...${method.last_four}): ${input.description}`,
        req.auth!.userId,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.PAYMENT_PROCESS,
      resourceType: 'payment_transaction',
      resourceId: transactionId,
      details: { patient_id: input.patient_id, amount_cents: input.amount_cents, last_four: method.last_four },
      req,
    });

    res.status(201).json({
      success: true,
      data: {
        transaction_id: transactionId,
        amount_cents: input.amount_cents,
        status: 'completed',
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

// ── Process Refund ──
router.post('/refund', requirePermission(Permission.PAYMENT_PROCESS), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      transaction_id: z.string().uuid(),
      amount_cents: z.number().int().positive().optional(),
    });
    const input = schema.parse(req.body);

    // Fetch original transaction
    const txnResult = await query(
      `SELECT id, patient_id, payment_method_id, amount_cents, processor_transaction_id, status
       FROM payment_transactions
       WHERE id = $1 AND clinic_id = $2 AND status = 'completed'`,
      [input.transaction_id, req.auth!.clinicId]
    );

    if (txnResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Original transaction not found or not eligible for refund' });
      return;
    }

    const originalTxn = txnResult.rows[0];
    const refundAmount = input.amount_cents || originalTxn.amount_cents;

    // Validate refund doesn't exceed original charge
    // Sum existing refunds for this transaction
    const existingRefunds = await query(
      `SELECT COALESCE(SUM(amount_cents), 0) as total_refunded
       FROM payment_transactions
       WHERE clinic_id = $1 AND description = $2`,
      [req.auth!.clinicId, `Refund for transaction ${input.transaction_id}`]
    );

    const totalRefunded = parseInt(existingRefunds.rows[0].total_refunded, 10);
    if (totalRefunded + refundAmount > originalTxn.amount_cents) {
      res.status(400).json({
        success: false,
        error: 'Refund amount exceeds remaining refundable amount',
        data: {
          original_amount: originalTxn.amount_cents,
          already_refunded: totalRefunded,
          max_refundable: originalTxn.amount_cents - totalRefunded,
        },
      });
      return;
    }

    // Create refund transaction
    const refundResult = await query(
      `INSERT INTO payment_transactions (clinic_id, patient_id, payment_method_id, amount_cents, description, processor_transaction_id, status, processed_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7)
       RETURNING id`,
      [
        req.auth!.clinicId,
        originalTxn.patient_id,
        originalTxn.payment_method_id,
        refundAmount,
        `Refund for transaction ${input.transaction_id}`,
        originalTxn.processor_transaction_id,
        req.auth!.userId,
      ]
    );

    const refundId = refundResult.rows[0].id;

    // Create corresponding ledger entry
    await query(
      `INSERT INTO ledger_entries (clinic_id, patient_id, entry_type, amount_cents, description, posted_by)
       VALUES ($1, $2, 'refund', $3, $4, $5)`,
      [
        req.auth!.clinicId,
        originalTxn.patient_id,
        refundAmount,
        `Refund for transaction ${input.transaction_id}`,
        req.auth!.userId,
      ]
    );

    // If fully refunded, mark original as refunded
    if (totalRefunded + refundAmount >= originalTxn.amount_cents) {
      await query(
        `UPDATE payment_transactions SET status = 'refunded' WHERE id = $1 AND clinic_id = $2`,
        [input.transaction_id, req.auth!.clinicId]
      );
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.PAYMENT_REFUND,
      resourceType: 'payment_transaction',
      resourceId: refundId,
      details: {
        original_transaction_id: input.transaction_id,
        refund_amount_cents: refundAmount,
        patient_id: originalTxn.patient_id,
      },
      req,
    });

    res.status(201).json({
      success: true,
      data: {
        refund_id: refundId,
        original_transaction_id: input.transaction_id,
        amount_cents: refundAmount,
        status: 'completed',
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

// ── List Transactions for a Patient ──
router.get('/transactions/:patientId', requirePermission(Permission.PAYMENT_VIEW), async (req: Request, res: Response) => {
  try {
    const { page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, parseInt(limit as string, 10));

    const countResult = await query(
      `SELECT COUNT(*) as total
       FROM payment_transactions
       WHERE clinic_id = $1 AND patient_id = $2`,
      [req.auth!.clinicId, req.params.patientId]
    );

    const result = await query(
      `SELECT pt.*, pm.brand, pm.last_four, pm.type as method_type
       FROM payment_transactions pt
       LEFT JOIN payment_methods pm ON pt.payment_method_id = pm.id
       WHERE pt.clinic_id = $1 AND pt.patient_id = $2
       ORDER BY pt.created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.auth!.clinicId, req.params.patientId, limitNum, (pageNum - 1) * limitNum]
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
