import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Static MIPS Measure Definitions (Common PT Measures) ──

const MIPS_MEASURE_DEFINITIONS = [
  {
    measure_id: '126',
    title: 'Diabetes: Eye Exam',
    description: 'Percentage of patients aged 18-75 with diabetes who had a retinal or dilated eye exam during the measurement period or a negative retinal exam in the 12 months prior.',
    category: 'process',
    high_priority: false,
  },
  {
    measure_id: '128',
    title: 'Body Mass Index (BMI) Screening and Follow-Up Plan',
    description: 'Percentage of patients aged 18 and older with a BMI documented during the current encounter or within the previous 12 months AND who had a follow-up plan documented if BMI is outside normal parameters.',
    category: 'process',
    high_priority: true,
  },
  {
    measure_id: '130',
    title: 'Documentation of Current Medications in the Medical Record',
    description: 'Percentage of visits for patients aged 18 and older for which the eligible professional or eligible clinician attests to documenting a list of current medications.',
    category: 'process',
    high_priority: false,
  },
  {
    measure_id: '131',
    title: 'Pain Assessment and Follow-Up',
    description: 'Percentage of visits for patients aged 18 and older with documentation of a pain assessment using a standardized tool AND a follow-up plan when pain is present.',
    category: 'process',
    high_priority: true,
  },
  {
    measure_id: '154',
    title: 'Falls: Risk Assessment',
    description: 'Percentage of patients aged 65 years and older who were screened for future fall risk during the measurement period.',
    category: 'process',
    high_priority: true,
  },
  {
    measure_id: '155',
    title: 'Falls: Plan of Care',
    description: 'Percentage of patients aged 65 years and older with a documented plan of care for falls prevention.',
    category: 'process',
    high_priority: true,
  },
  {
    measure_id: '182',
    title: 'Functional Outcome Assessment',
    description: 'Percentage of visits for patients aged 18 and older with documentation of a current functional outcome assessment using a standardized functional outcome assessment tool on the date of the encounter.',
    category: 'outcome',
    high_priority: true,
  },
  {
    measure_id: '226',
    title: 'Preventive Care and Screening: Tobacco Use: Screening and Cessation Intervention',
    description: 'Percentage of patients aged 18 and older who were screened for tobacco use one or more times within the measurement period AND who received cessation intervention if identified as a tobacco user.',
    category: 'process',
    high_priority: true,
  },
];

// ── GET /definitions ── Static MIPS measure definitions for PT
router.get('/definitions', async (_req: Request, res: Response) => {
  res.json({ success: true, data: MIPS_MEASURE_DEFINITIONS });
});

// ── GET / ── List MIPS measures with filters and pagination
router.get('/', requirePermission(Permission.MIPS_VIEW), async (req: Request, res: Response) => {
  try {
    const { provider_id, year, measure_id, submitted, page = '1', limit = '25' } = req.query;
    const conditions: string[] = ['m.clinic_id = $1'];
    const params: unknown[] = [req.auth!.clinicId];
    let idx = 2;

    if (provider_id) {
      conditions.push(`m.provider_id = $${idx++}`);
      params.push(provider_id);
    }
    if (year) {
      const yearNum = parseInt(year as string, 10);
      conditions.push(`EXTRACT(YEAR FROM m.reporting_period_start) = $${idx++}`);
      params.push(yearNum);
    }
    if (measure_id) {
      conditions.push(`m.measure_id = $${idx++}`);
      params.push(measure_id);
    }
    if (submitted !== undefined && submitted !== '') {
      conditions.push(`m.submitted = $${idx++}`);
      params.push(submitted === 'true');
    }

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, parseInt(limit as string, 10));

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM mips_measures m WHERE ${conditions.join(' AND ')}`,
      params
    );

    const result = await query(
      `SELECT m.*,
              p.first_name AS patient_first_name, p.last_name AS patient_last_name, p.mrn,
              u.first_name AS provider_first_name, u.last_name AS provider_last_name
       FROM mips_measures m
       JOIN patients p ON m.patient_id = p.id
       JOIN users u ON m.provider_id = u.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY m.created_at DESC
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

// ── GET /summary ── Performance summary for a reporting period
router.get('/summary', requirePermission(Permission.MIPS_VIEW), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      year: z.coerce.number().int().min(2020).max(2100),
      provider_id: z.string().uuid().optional(),
    });
    const parsed = schema.parse({
      year: req.query.year,
      provider_id: req.query.provider_id || undefined,
    });

    const conditions: string[] = [
      'm.clinic_id = $1',
      'EXTRACT(YEAR FROM m.reporting_period_start) = $2',
    ];
    const params: unknown[] = [req.auth!.clinicId, parsed.year];
    let idx = 3;

    if (parsed.provider_id) {
      conditions.push(`m.provider_id = $${idx++}`);
      params.push(parsed.provider_id);
    }

    const whereClause = conditions.join(' AND ');

    const result = await query(
      `SELECT
         m.measure_id,
         m.measure_title,
         COUNT(*) FILTER (WHERE m.denominator = true) AS denominator_count,
         COUNT(*) FILTER (WHERE m.numerator = true) AS numerator_count,
         COUNT(*) FILTER (WHERE m.exclusion = true) AS exclusion_count,
         CASE
           WHEN COUNT(*) FILTER (WHERE m.denominator = true) - COUNT(*) FILTER (WHERE m.exclusion = true) > 0
           THEN ROUND(
             COUNT(*) FILTER (WHERE m.numerator = true)::numeric /
             (COUNT(*) FILTER (WHERE m.denominator = true) - COUNT(*) FILTER (WHERE m.exclusion = true))::numeric * 100,
             2
           )
           ELSE 0
         END AS performance_rate,
         COUNT(*) FILTER (WHERE m.submitted = true) AS submitted_count,
         COUNT(*) AS total_records
       FROM mips_measures m
       WHERE ${whereClause}
       GROUP BY m.measure_id, m.measure_title
       ORDER BY m.measure_id`,
      params
    );

    res.json({
      success: true,
      data: {
        year: parsed.year,
        provider_id: parsed.provider_id || null,
        measures: result.rows,
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

// ── POST / ── Record a MIPS measure
router.post('/', requirePermission(Permission.MIPS_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      patient_id: z.string().uuid(),
      note_id: z.string().uuid().optional().nullable(),
      provider_id: z.string().uuid(),
      measure_id: z.string().min(1),
      measure_title: z.string().min(1),
      numerator: z.boolean(),
      denominator: z.boolean(),
      exclusion: z.boolean(),
      reporting_period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reporting_period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    });
    const input = schema.parse(req.body);

    const result = await query(
      `INSERT INTO mips_measures
         (clinic_id, patient_id, note_id, provider_id, measure_id, measure_title,
          numerator, denominator, exclusion, reporting_period_start, reporting_period_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        req.auth!.clinicId, input.patient_id, input.note_id || null,
        input.provider_id, input.measure_id, input.measure_title,
        input.numerator, input.denominator, input.exclusion,
        input.reporting_period_start, input.reporting_period_end,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.MIPS_RECORD,
      resourceType: 'mips_measure',
      resourceId: result.rows[0].id,
      details: { measure_id: input.measure_id, provider_id: input.provider_id },
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

// ── PUT /:id ── Update a MIPS measure
router.put('/:id', requirePermission(Permission.MIPS_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      patient_id: z.string().uuid().optional(),
      note_id: z.string().uuid().optional().nullable(),
      provider_id: z.string().uuid().optional(),
      measure_id: z.string().min(1).optional(),
      measure_title: z.string().min(1).optional(),
      numerator: z.boolean().optional(),
      denominator: z.boolean().optional(),
      exclusion: z.boolean().optional(),
      reporting_period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      reporting_period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    });
    const input = schema.parse(req.body);

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const params: unknown[] = [req.params.id, req.auth!.clinicId];
    let idx = 3;

    if (input.patient_id !== undefined) {
      setClauses.push(`patient_id = $${idx++}`);
      params.push(input.patient_id);
    }
    if (input.note_id !== undefined) {
      setClauses.push(`note_id = $${idx++}`);
      params.push(input.note_id);
    }
    if (input.provider_id !== undefined) {
      setClauses.push(`provider_id = $${idx++}`);
      params.push(input.provider_id);
    }
    if (input.measure_id !== undefined) {
      setClauses.push(`measure_id = $${idx++}`);
      params.push(input.measure_id);
    }
    if (input.measure_title !== undefined) {
      setClauses.push(`measure_title = $${idx++}`);
      params.push(input.measure_title);
    }
    if (input.numerator !== undefined) {
      setClauses.push(`numerator = $${idx++}`);
      params.push(input.numerator);
    }
    if (input.denominator !== undefined) {
      setClauses.push(`denominator = $${idx++}`);
      params.push(input.denominator);
    }
    if (input.exclusion !== undefined) {
      setClauses.push(`exclusion = $${idx++}`);
      params.push(input.exclusion);
    }
    if (input.reporting_period_start !== undefined) {
      setClauses.push(`reporting_period_start = $${idx++}`);
      params.push(input.reporting_period_start);
    }
    if (input.reporting_period_end !== undefined) {
      setClauses.push(`reporting_period_end = $${idx++}`);
      params.push(input.reporting_period_end);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    setClauses.push('updated_at = NOW()');

    const result = await query(
      `UPDATE mips_measures SET ${setClauses.join(', ')}
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'MIPS measure not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.MIPS_RECORD,
      resourceType: 'mips_measure',
      resourceId: req.params.id,
      details: { updated_fields: Object.keys(input) },
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

// ── POST /submit ── Mark measures as submitted for a reporting period
router.post('/submit', requirePermission(Permission.MIPS_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      provider_id: z.string().uuid(),
      year: z.number().int().min(2020).max(2100),
    });
    const input = schema.parse(req.body);

    const result = await query(
      `UPDATE mips_measures
       SET submitted = true, submitted_at = NOW(), updated_at = NOW()
       WHERE clinic_id = $1
         AND provider_id = $2
         AND EXTRACT(YEAR FROM reporting_period_start) = $3
         AND submitted = false
       RETURNING id`,
      [req.auth!.clinicId, input.provider_id, input.year]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.MIPS_SUBMIT,
      resourceType: 'mips_measure',
      resourceId: input.provider_id,
      details: { year: input.year, measures_submitted: result.rowCount },
      req,
    });

    res.json({
      success: true,
      data: {
        provider_id: input.provider_id,
        year: input.year,
        measures_submitted: result.rowCount,
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

export default router;
