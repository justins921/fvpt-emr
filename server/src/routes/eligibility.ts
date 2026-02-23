import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Run Eligibility Check ──
router.post('/check', requirePermission(Permission.ELIGIBILITY_CHECK), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      patientId: z.string().uuid(),
      insuranceId: z.string().uuid(),
    });
    const input = schema.parse(req.body);

    // Verify patient belongs to this clinic
    const patientResult = await query(
      'SELECT * FROM patients WHERE id = $1 AND clinic_id = $2',
      [input.patientId, req.auth!.clinicId]
    );
    if (patientResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    // Verify insurance belongs to this patient and clinic
    const insuranceResult = await query(
      'SELECT * FROM insurance WHERE id = $1 AND patient_id = $2 AND clinic_id = $3',
      [input.insuranceId, input.patientId, req.auth!.clinicId]
    );
    if (insuranceResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Insurance not found' });
      return;
    }

    const patient = patientResult.rows[0];
    const insurance = insuranceResult.rows[0];

    // Check clinic settings for a configured clearinghouse adapter
    const clinicResult = await query(
      'SELECT settings FROM clinics WHERE id = $1',
      [req.auth!.clinicId]
    );
    const clinicSettings = clinicResult.rows[0]?.settings || {};
    const clearinghouseType = clinicSettings.clearinghouse_adapter as string | undefined;

    if (clearinghouseType) {
      // Attempt electronic eligibility check via clearinghouse adapter
      try {
        let adapter;
        if (clearinghouseType === 'sandbox') {
          const { SandboxClearinghouseAdapter } = await import('../adapters/sandbox-clearinghouse');
          adapter = new SandboxClearinghouseAdapter();
        } else {
          // Future adapters (office_ally, availity, optum, etc.) would be loaded here
          res.status(400).json({
            success: false,
            error: `Unsupported clearinghouse adapter: ${clearinghouseType}`,
          });
          return;
        }

        const response = await adapter.eligibility270(patient, insurance);

        const details = response.details || {};
        const status = response.eligible ? 'eligible' : 'ineligible';

        const result = await query(
          `INSERT INTO eligibility_checks
            (clinic_id, patient_id, insurance_id, status,
             copay_cents, deductible_cents, deductible_met_cents,
             coinsurance_pct, out_of_pocket_max_cents, out_of_pocket_met_cents,
             pt_visits_allowed, pt_visits_used, requires_authorization,
             response_raw, checked_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING *`,
          [
            req.auth!.clinicId,
            input.patientId,
            input.insuranceId,
            status,
            details.copay ?? null,
            details.deductible ?? null,
            details.deductibleMet ?? null,
            details.coinsurance ?? null,
            details.outOfPocketMax ?? null,
            details.outOfPocketMet ?? null,
            details.ptVisitsAllowed ?? null,
            details.ptVisitsUsed ?? null,
            details.authRequired ?? null,
            JSON.stringify(response),
            req.auth!.userId,
          ]
        );

        await logAudit({
          clinicId: req.auth!.clinicId,
          userId: req.auth!.userId,
          action: AuditAction.ELIGIBILITY_CHECK,
          resourceType: 'eligibility_check',
          resourceId: result.rows[0].id,
          details: { method: 'electronic', adapter: clearinghouseType, status },
          req,
        });

        res.status(201).json({ success: true, data: result.rows[0] });
      } catch (adapterErr) {
        // Adapter call failed -- store the error and return it
        const errorMessage = (adapterErr as Error).message || 'Clearinghouse request failed';

        const result = await query(
          `INSERT INTO eligibility_checks
            (clinic_id, patient_id, insurance_id, status, error_message, checked_by)
           VALUES ($1,$2,$3,'error',$4,$5)
           RETURNING *`,
          [
            req.auth!.clinicId,
            input.patientId,
            input.insuranceId,
            errorMessage,
            req.auth!.userId,
          ]
        );

        await logAudit({
          clinicId: req.auth!.clinicId,
          userId: req.auth!.userId,
          action: AuditAction.ELIGIBILITY_CHECK,
          resourceType: 'eligibility_check',
          resourceId: result.rows[0].id,
          details: { method: 'electronic', adapter: clearinghouseType, status: 'error' },
          req,
        });

        res.status(201).json({
          success: true,
          data: result.rows[0],
          warning: 'Clearinghouse returned an error. You may enter eligibility data manually.',
        });
      }
    } else {
      // No clearinghouse configured -- create a pending check record
      // and return a response indicating manual entry is required
      const result = await query(
        `INSERT INTO eligibility_checks
          (clinic_id, patient_id, insurance_id, status, checked_by)
         VALUES ($1,$2,$3,'pending',$4)
         RETURNING *`,
        [
          req.auth!.clinicId,
          input.patientId,
          input.insuranceId,
          req.auth!.userId,
        ]
      );

      await logAudit({
        clinicId: req.auth!.clinicId,
        userId: req.auth!.userId,
        action: AuditAction.ELIGIBILITY_CHECK,
        resourceType: 'eligibility_check',
        resourceId: result.rows[0].id,
        details: { method: 'manual_pending', status: 'pending' },
        req,
      });

      res.status(201).json({
        success: true,
        data: result.rows[0],
        manualEntryRequired: true,
        message: 'No clearinghouse adapter configured. Please enter eligibility data manually using POST /manual.',
      });
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── List Past Eligibility Checks ──
router.get('/history', requirePermission(Permission.ELIGIBILITY_VIEW), async (req: Request, res: Response) => {
  try {
    const { patientId, fromDate, toDate, page = '1', limit = '25' } = req.query;
    const conditions: string[] = ['ec.clinic_id = $1'];
    const params: unknown[] = [req.auth!.clinicId];
    let idx = 2;

    if (patientId) {
      conditions.push(`ec.patient_id = $${idx++}`);
      params.push(patientId);
    }
    if (fromDate) {
      conditions.push(`ec.check_date >= $${idx++}`);
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push(`ec.check_date <= $${idx++}`);
      params.push(toDate);
    }

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, parseInt(limit as string, 10));

    const countResult = await query(
      `SELECT COUNT(*) as total FROM eligibility_checks ec WHERE ${conditions.join(' AND ')}`,
      params
    );

    const result = await query(
      `SELECT ec.*,
              p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
              ins.payer_name, ins.member_id,
              u.first_name as checked_by_first_name, u.last_name as checked_by_last_name
       FROM eligibility_checks ec
       JOIN patients p ON ec.patient_id = p.id
       LEFT JOIN insurance ins ON ec.insurance_id = ins.id
       LEFT JOIN users u ON ec.checked_by = u.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ec.check_date DESC
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

// ── Get Single Eligibility Check ──
router.get('/:id', requirePermission(Permission.ELIGIBILITY_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT ec.*,
              p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
              ins.payer_name, ins.member_id, ins.plan_name, ins.group_number,
              u.first_name as checked_by_first_name, u.last_name as checked_by_last_name
       FROM eligibility_checks ec
       JOIN patients p ON ec.patient_id = p.id
       LEFT JOIN insurance ins ON ec.insurance_id = ins.id
       LEFT JOIN users u ON ec.checked_by = u.id
       WHERE ec.id = $1 AND ec.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Eligibility check not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Manual Eligibility Entry ──
router.post('/manual', requirePermission(Permission.ELIGIBILITY_CHECK), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      patientId: z.string().uuid(),
      insuranceId: z.string().uuid(),
      copayCents: z.number().int().min(0),
      deductibleCents: z.number().int().min(0),
      deductibleMetCents: z.number().int().min(0),
      coinsurancePct: z.number().min(0).max(100),
      outOfPocketMaxCents: z.number().int().min(0),
      outOfPocketMetCents: z.number().int().min(0),
      ptVisitsAllowed: z.number().int().min(0),
      ptVisitsUsed: z.number().int().min(0),
      requiresAuthorization: z.boolean(),
      status: z.enum(['eligible', 'ineligible']),
    });
    const input = schema.parse(req.body);

    // Verify patient belongs to this clinic
    const patientResult = await query(
      'SELECT id FROM patients WHERE id = $1 AND clinic_id = $2',
      [input.patientId, req.auth!.clinicId]
    );
    if (patientResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    // Verify insurance belongs to this patient and clinic
    const insuranceResult = await query(
      'SELECT id FROM insurance WHERE id = $1 AND patient_id = $2 AND clinic_id = $3',
      [input.insuranceId, input.patientId, req.auth!.clinicId]
    );
    if (insuranceResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Insurance not found' });
      return;
    }

    const result = await query(
      `INSERT INTO eligibility_checks
        (clinic_id, patient_id, insurance_id, status,
         copay_cents, deductible_cents, deductible_met_cents,
         coinsurance_pct, out_of_pocket_max_cents, out_of_pocket_met_cents,
         pt_visits_allowed, pt_visits_used, requires_authorization,
         response_raw, checked_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        req.auth!.clinicId,
        input.patientId,
        input.insuranceId,
        input.status,
        input.copayCents,
        input.deductibleCents,
        input.deductibleMetCents,
        input.coinsurancePct,
        input.outOfPocketMaxCents,
        input.outOfPocketMetCents,
        input.ptVisitsAllowed,
        input.ptVisitsUsed,
        input.requiresAuthorization,
        JSON.stringify({ method: 'manual', enteredBy: req.auth!.userId }),
        req.auth!.userId,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.ELIGIBILITY_CHECK,
      resourceType: 'eligibility_check',
      resourceId: result.rows[0].id,
      details: { method: 'manual', status: input.status },
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

export default router;
