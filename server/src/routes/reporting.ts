import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission } from '../types';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Shared Zod schemas for query params ──

const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const dateRangeWithTherapistSchema = dateRangeSchema.extend({
  therapistId: z.string().uuid().optional(),
});

// ── GET /dashboard ── Dashboard KPIs
router.get('/dashboard', requirePermission(Permission.REPORT_VIEW), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;

    const [
      patientsResult,
      todayAppointmentsResult,
      pocExpirationResult,
      pendingAuthResult,
      unreadMessagesResult,
      overdueTasksResult,
    ] = await Promise.all([
      // Total and active patients
      query(
        `SELECT
           COUNT(*) AS total_patients,
           COUNT(*) FILTER (WHERE is_active = true) AS active_patients
         FROM patients
         WHERE clinic_id = $1`,
        [clinicId]
      ),

      // Today's appointment stats
      query(
        `SELECT
           COUNT(*) AS today_appointments,
           COUNT(*) FILTER (WHERE status = 'completed') AS today_completed,
           COUNT(*) FILTER (WHERE status = 'no_show') AS today_no_shows,
           COUNT(*) FILTER (WHERE status = 'cancelled') AS today_cancellations
         FROM appointments
         WHERE clinic_id = $1
           AND start_time >= CURRENT_DATE
           AND start_time < CURRENT_DATE + INTERVAL '1 day'`,
        [clinicId]
      ),

      // Upcoming POC expirations (next 14 days)
      query(
        `SELECT COUNT(*) AS upcoming_poc_expirations
         FROM plans_of_care
         WHERE clinic_id = $1
           AND status = 'active'
           AND (
             (end_date IS NOT NULL AND end_date <= CURRENT_DATE + INTERVAL '14 days' AND end_date >= CURRENT_DATE)
             OR (recertification_due_date IS NOT NULL AND recertification_due_date <= CURRENT_DATE + INTERVAL '14 days' AND recertification_due_date >= CURRENT_DATE)
           )`,
        [clinicId]
      ),

      // Pending authorizations
      query(
        `SELECT COUNT(*) AS pending_authorizations
         FROM authorizations
         WHERE clinic_id = $1
           AND status = 'pending'`,
        [clinicId]
      ),

      // Unread messages (inbound with status 'received')
      query(
        `SELECT COUNT(*) AS unread_messages
         FROM sms_messages
         WHERE clinic_id = $1
           AND direction = 'inbound'
           AND status = 'received'`,
        [clinicId]
      ),

      // Overdue tasks
      query(
        `SELECT COUNT(*) AS overdue_tasks
         FROM tasks
         WHERE clinic_id = $1
           AND status NOT IN ('completed', 'cancelled')
           AND due_date < CURRENT_DATE`,
        [clinicId]
      ),
    ]);

    const patients = patientsResult.rows[0];
    const todayAppts = todayAppointmentsResult.rows[0];

    res.json({
      success: true,
      data: {
        total_patients: parseInt(patients.total_patients, 10),
        active_patients: parseInt(patients.active_patients, 10),
        today_appointments: parseInt(todayAppts.today_appointments, 10),
        today_completed: parseInt(todayAppts.today_completed, 10),
        today_no_shows: parseInt(todayAppts.today_no_shows, 10),
        today_cancellations: parseInt(todayAppts.today_cancellations, 10),
        upcoming_poc_expirations: parseInt(pocExpirationResult.rows[0].upcoming_poc_expirations, 10),
        pending_authorizations: parseInt(pendingAuthResult.rows[0].pending_authorizations, 10),
        unread_messages: parseInt(unreadMessagesResult.rows[0].unread_messages, 10),
        overdue_tasks: parseInt(overdueTasksResult.rows[0].overdue_tasks, 10),
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /productivity ── Therapist productivity report
router.get('/productivity', requirePermission(Permission.REPORT_VIEW), async (req: Request, res: Response) => {
  try {
    const parsed = dateRangeWithTherapistSchema.parse({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      therapistId: req.query.therapistId || undefined,
    });

    const clinicId = req.auth!.clinicId;
    const conditions: string[] = [
      'a.clinic_id = $1',
      'a.start_time >= $2::date',
      'a.start_time < ($3::date + INTERVAL \'1 day\')',
    ];
    const params: unknown[] = [clinicId, parsed.startDate, parsed.endDate];
    let idx = 4;

    if (parsed.therapistId) {
      conditions.push(`a.therapist_id = $${idx++}`);
      params.push(parsed.therapistId);
    }

    const whereClause = conditions.join(' AND ');

    const result = await query(
      `SELECT
         u.id AS therapist_id,
         u.first_name AS therapist_first_name,
         u.last_name AS therapist_last_name,
         u.credential AS therapist_credential,
         COUNT(DISTINCT a.patient_id) AS patient_count,
         COUNT(a.id) AS visit_count,
         COALESCE(
           ROUND(AVG(
             (SELECT SUM((item->>'units')::numeric)
              FROM clinical_notes cn,
                   jsonb_array_elements(
                     (SELECT c2.line_items FROM claims c2 WHERE c2.appointment_id = a.id AND c2.clinic_id = $1 LIMIT 1)
                   ) AS item
              WHERE cn.appointment_id = a.id AND cn.clinic_id = $1
              LIMIT 1)
           ), 2),
           0
         ) AS units_per_visit,
         COALESCE(ROUND(AVG(cn_agg.treatment_time_minutes), 1), 0) AS average_treatment_time,
         ROUND(
           COUNT(*) FILTER (WHERE a.status = 'cancelled')::numeric /
           NULLIF(COUNT(*)::numeric, 0) * 100, 1
         ) AS cancellation_rate,
         ROUND(
           COUNT(*) FILTER (WHERE a.status = 'no_show')::numeric /
           NULLIF(COUNT(*)::numeric, 0) * 100, 1
         ) AS no_show_rate
       FROM appointments a
       JOIN users u ON a.therapist_id = u.id
       LEFT JOIN LATERAL (
         SELECT cn.treatment_time_minutes
         FROM clinical_notes cn
         WHERE cn.appointment_id = a.id AND cn.clinic_id = $1
         ORDER BY cn.created_at DESC
         LIMIT 1
       ) cn_agg ON true
       WHERE ${whereClause}
       GROUP BY u.id, u.first_name, u.last_name, u.credential
       ORDER BY u.last_name, u.first_name`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /revenue ── Revenue report
router.get('/revenue', requirePermission(Permission.REPORT_VIEW), async (req: Request, res: Response) => {
  try {
    const schema = dateRangeSchema.extend({
      groupBy: z.enum(['provider', 'payer', 'service', 'month']).optional().default('month'),
    });
    const parsed = schema.parse({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      groupBy: req.query.groupBy || 'month',
    });

    const clinicId = req.auth!.clinicId;

    let groupByColumn: string;
    let groupByAlias: string;
    let groupBySelect: string;

    switch (parsed.groupBy) {
      case 'provider':
        groupBySelect = `u.first_name || ' ' || u.last_name || COALESCE(' (' || u.credential || ')', '') AS group_label`;
        groupByColumn = 'u.id';
        groupByAlias = 'u.id, u.first_name, u.last_name, u.credential';
        break;
      case 'payer':
        groupBySelect = `COALESCE(i.payer_name, 'Self-Pay') AS group_label`;
        groupByColumn = `COALESCE(i.payer_name, 'Self-Pay')`;
        groupByAlias = groupByColumn;
        break;
      case 'service':
        groupBySelect = `le.cpt_code AS group_label`;
        groupByColumn = 'le.cpt_code';
        groupByAlias = 'le.cpt_code';
        break;
      case 'month':
      default:
        groupBySelect = `TO_CHAR(le.service_date, 'YYYY-MM') AS group_label`;
        groupByColumn = `TO_CHAR(le.service_date, 'YYYY-MM')`;
        groupByAlias = groupByColumn;
        break;
    }

    // Build the join clauses based on groupBy
    let joinClauses = '';
    if (parsed.groupBy === 'provider') {
      joinClauses = 'LEFT JOIN users u ON le.posted_by = u.id';
    } else if (parsed.groupBy === 'payer') {
      joinClauses = `LEFT JOIN claims c ON le.claim_id = c.id
                     LEFT JOIN insurance i ON c.insurance_id = i.id`;
    }

    const result = await query(
      `SELECT
         ${groupBySelect},
         COALESCE(SUM(le.amount_cents) FILTER (WHERE le.entry_type = 'charge'), 0) AS total_charges,
         COALESCE(SUM(le.amount_cents) FILTER (WHERE le.entry_type = 'payment'), 0) AS total_payments,
         COALESCE(SUM(le.amount_cents) FILTER (WHERE le.entry_type IN ('adjustment', 'write_off')), 0) AS total_adjustments,
         COALESCE(SUM(le.amount_cents) FILTER (WHERE le.entry_type = 'charge'), 0)
           - COALESCE(SUM(le.amount_cents) FILTER (WHERE le.entry_type IN ('adjustment', 'write_off')), 0)
           AS net_revenue
       FROM ledger_entries le
       ${joinClauses}
       WHERE le.clinic_id = $1
         AND le.service_date >= $2::date
         AND le.service_date <= $3::date
       GROUP BY ${groupByAlias}
       ORDER BY ${parsed.groupBy === 'month' ? 'group_label ASC' : 'total_charges DESC'}`,
      [clinicId, parsed.startDate, parsed.endDate]
    );

    // Also compute overall totals
    const totalsResult = await query(
      `SELECT
         COALESCE(SUM(amount_cents) FILTER (WHERE entry_type = 'charge'), 0) AS total_charges,
         COALESCE(SUM(amount_cents) FILTER (WHERE entry_type = 'payment'), 0) AS total_payments,
         COALESCE(SUM(amount_cents) FILTER (WHERE entry_type IN ('adjustment', 'write_off')), 0) AS total_adjustments,
         COALESCE(SUM(amount_cents) FILTER (WHERE entry_type = 'charge'), 0)
           - COALESCE(SUM(amount_cents) FILTER (WHERE entry_type IN ('adjustment', 'write_off')), 0)
           AS net_revenue
       FROM ledger_entries
       WHERE clinic_id = $1
         AND service_date >= $2::date
         AND service_date <= $3::date`,
      [clinicId, parsed.startDate, parsed.endDate]
    );

    res.json({
      success: true,
      data: {
        breakdown: result.rows,
        totals: totalsResult.rows[0],
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

// ── GET /referrals ── Referral analytics
router.get('/referrals', requirePermission(Permission.REPORT_VIEW), async (req: Request, res: Response) => {
  try {
    const parsed = dateRangeSchema.parse({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    const clinicId = req.auth!.clinicId;

    // By referral source
    const bySourceResult = await query(
      `SELECT
         COALESCE(p.referral_source, 'Unknown') AS referral_source,
         COUNT(DISTINCT p.id) AS patient_count,
         COUNT(a.id) AS visit_count,
         COALESCE(SUM(le.amount_cents) FILTER (WHERE le.entry_type = 'charge'), 0) AS revenue
       FROM patients p
       LEFT JOIN appointments a
         ON a.patient_id = p.id
         AND a.clinic_id = $1
         AND a.start_time >= $2::date
         AND a.start_time < ($3::date + INTERVAL '1 day')
         AND a.status NOT IN ('cancelled')
       LEFT JOIN ledger_entries le
         ON le.patient_id = p.id
         AND le.clinic_id = $1
         AND le.service_date >= $2::date
         AND le.service_date <= $3::date
         AND le.entry_type = 'charge'
       WHERE p.clinic_id = $1
         AND p.created_at >= $2::date
         AND p.created_at < ($3::date + INTERVAL '1 day')
       GROUP BY p.referral_source
       ORDER BY patient_count DESC`,
      [clinicId, parsed.startDate, parsed.endDate]
    );

    // By referring provider
    const byProviderResult = await query(
      `SELECT
         COALESCE(p.referring_provider, 'Unknown') AS referring_provider,
         p.referring_provider_npi,
         COUNT(DISTINCT p.id) AS patient_count,
         COUNT(a.id) AS visit_count,
         COALESCE(SUM(le.amount_cents) FILTER (WHERE le.entry_type = 'charge'), 0) AS revenue
       FROM patients p
       LEFT JOIN appointments a
         ON a.patient_id = p.id
         AND a.clinic_id = $1
         AND a.start_time >= $2::date
         AND a.start_time < ($3::date + INTERVAL '1 day')
         AND a.status NOT IN ('cancelled')
       LEFT JOIN ledger_entries le
         ON le.patient_id = p.id
         AND le.clinic_id = $1
         AND le.service_date >= $2::date
         AND le.service_date <= $3::date
         AND le.entry_type = 'charge'
       WHERE p.clinic_id = $1
         AND p.created_at >= $2::date
         AND p.created_at < ($3::date + INTERVAL '1 day')
         AND p.referring_provider IS NOT NULL
       GROUP BY p.referring_provider, p.referring_provider_npi
       ORDER BY patient_count DESC`,
      [clinicId, parsed.startDate, parsed.endDate]
    );

    res.json({
      success: true,
      data: {
        by_referral_source: bySourceResult.rows,
        by_referring_provider: byProviderResult.rows,
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

// ── GET /visit-stats ── Visit statistics
router.get('/visit-stats', requirePermission(Permission.REPORT_VIEW), async (req: Request, res: Response) => {
  try {
    const parsed = dateRangeSchema.parse({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    const clinicId = req.auth!.clinicId;

    const [visitsPerDayResult, visitTypeResult, avgVisitsResult, newPatientsResult] = await Promise.all([
      // Visits per day (time series)
      query(
        `SELECT
           DATE(start_time) AS visit_date,
           COUNT(*) AS visit_count
         FROM appointments
         WHERE clinic_id = $1
           AND start_time >= $2::date
           AND start_time < ($3::date + INTERVAL '1 day')
           AND status NOT IN ('cancelled')
         GROUP BY DATE(start_time)
         ORDER BY visit_date`,
        [clinicId, parsed.startDate, parsed.endDate]
      ),

      // Visit type breakdown
      query(
        `SELECT
           appointment_type,
           COUNT(*) AS count
         FROM appointments
         WHERE clinic_id = $1
           AND start_time >= $2::date
           AND start_time < ($3::date + INTERVAL '1 day')
           AND status NOT IN ('cancelled')
         GROUP BY appointment_type
         ORDER BY count DESC`,
        [clinicId, parsed.startDate, parsed.endDate]
      ),

      // Average visits per patient
      query(
        `SELECT
           ROUND(AVG(visit_count), 2) AS average_visits_per_patient
         FROM (
           SELECT patient_id, COUNT(*) AS visit_count
           FROM appointments
           WHERE clinic_id = $1
             AND start_time >= $2::date
             AND start_time < ($3::date + INTERVAL '1 day')
             AND status NOT IN ('cancelled')
           GROUP BY patient_id
         ) sub`,
        [clinicId, parsed.startDate, parsed.endDate]
      ),

      // New patients per period (monthly buckets)
      query(
        `SELECT
           TO_CHAR(created_at, 'YYYY-MM') AS period,
           COUNT(*) AS new_patients
         FROM patients
         WHERE clinic_id = $1
           AND created_at >= $2::date
           AND created_at < ($3::date + INTERVAL '1 day')
         GROUP BY TO_CHAR(created_at, 'YYYY-MM')
         ORDER BY period`,
        [clinicId, parsed.startDate, parsed.endDate]
      ),
    ]);

    res.json({
      success: true,
      data: {
        visits_per_day: visitsPerDayResult.rows,
        visit_type_breakdown: visitTypeResult.rows,
        average_visits_per_patient: parseFloat(avgVisitsResult.rows[0]?.average_visits_per_patient || '0'),
        new_patients_per_period: newPatientsResult.rows,
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

// ── GET /payer-mix ── Payer mix analysis
router.get('/payer-mix', requirePermission(Permission.REPORT_VIEW), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;

    const result = await query(
      `SELECT
         i.payer_name,
         COUNT(DISTINCT c.patient_id) AS patient_count,
         COUNT(c.id) AS claim_count,
         COALESCE(SUM(c.total_charge_cents), 0) AS total_charges,
         COALESCE(SUM(c.total_paid_cents), 0) AS total_paid,
         CASE
           WHEN SUM(c.total_charge_cents) > 0
           THEN ROUND(SUM(c.total_paid_cents)::numeric / SUM(c.total_charge_cents)::numeric * 100, 2)
           ELSE 0
         END AS average_reimbursement_rate,
         CASE
           WHEN COUNT(c.id) > 0
           THEN ROUND(
             COUNT(*) FILTER (WHERE c.status = 'denied')::numeric /
             COUNT(c.id)::numeric * 100, 2
           )
           ELSE 0
         END AS denial_rate
       FROM claims c
       JOIN insurance i ON c.insurance_id = i.id
       WHERE c.clinic_id = $1
       GROUP BY i.payer_name
       ORDER BY total_charges DESC`,
      [clinicId]
    );

    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /cancellation-no-show ── Cancellation and no-show rates
router.get('/cancellation-no-show', requirePermission(Permission.REPORT_VIEW), async (req: Request, res: Response) => {
  try {
    const parsed = dateRangeWithTherapistSchema.parse({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      therapistId: req.query.therapistId || undefined,
    });

    const clinicId = req.auth!.clinicId;
    const conditions: string[] = [
      'a.clinic_id = $1',
      'a.start_time >= $2::date',
      'a.start_time < ($3::date + INTERVAL \'1 day\')',
    ];
    const params: unknown[] = [clinicId, parsed.startDate, parsed.endDate];
    let idx = 4;

    if (parsed.therapistId) {
      conditions.push(`a.therapist_id = $${idx++}`);
      params.push(parsed.therapistId);
    }

    const whereClause = conditions.join(' AND ');

    const result = await query(
      `SELECT
         TO_CHAR(DATE(a.start_time), 'YYYY-MM') AS period,
         COUNT(*) AS total_scheduled,
         COUNT(*) FILTER (WHERE a.status = 'cancelled') AS cancelled,
         COUNT(*) FILTER (WHERE a.status = 'no_show') AS no_show,
         ROUND(
           COUNT(*) FILTER (WHERE a.status = 'cancelled')::numeric /
           NULLIF(COUNT(*)::numeric, 0) * 100, 2
         ) AS cancellation_rate,
         ROUND(
           COUNT(*) FILTER (WHERE a.status = 'no_show')::numeric /
           NULLIF(COUNT(*)::numeric, 0) * 100, 2
         ) AS no_show_rate
       FROM appointments a
       WHERE ${whereClause}
       GROUP BY TO_CHAR(DATE(a.start_time), 'YYYY-MM')
       ORDER BY period`,
      params
    );

    // Also compute overall totals for the range
    const totalsResult = await query(
      `SELECT
         COUNT(*) AS total_scheduled,
         COUNT(*) FILTER (WHERE a.status = 'cancelled') AS cancelled,
         COUNT(*) FILTER (WHERE a.status = 'no_show') AS no_show,
         ROUND(
           COUNT(*) FILTER (WHERE a.status = 'cancelled')::numeric /
           NULLIF(COUNT(*)::numeric, 0) * 100, 2
         ) AS cancellation_rate,
         ROUND(
           COUNT(*) FILTER (WHERE a.status = 'no_show')::numeric /
           NULLIF(COUNT(*)::numeric, 0) * 100, 2
         ) AS no_show_rate
       FROM appointments a
       WHERE ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: {
        by_period: result.rows,
        totals: totalsResult.rows[0],
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

// ── GET /authorization-status ── Authorization summary
router.get('/authorization-status', requirePermission(Permission.REPORT_VIEW), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;

    const [summaryResult, expiringResult, lowVisitsResult] = await Promise.all([
      // Overall counts
      query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'active') AS total_active,
           COUNT(*) FILTER (WHERE status = 'expired') AS total_expired
         FROM authorizations
         WHERE clinic_id = $1`,
        [clinicId]
      ),

      // Expiring soon (next 30 days)
      query(
        `SELECT
           auth.id,
           auth.authorization_number,
           auth.authorized_visits,
           auth.used_visits,
           auth.start_date,
           auth.end_date,
           auth.status,
           p.id AS patient_id,
           p.first_name AS patient_first_name,
           p.last_name AS patient_last_name,
           p.mrn
         FROM authorizations auth
         JOIN patients p ON auth.patient_id = p.id
         WHERE auth.clinic_id = $1
           AND auth.status = 'active'
           AND auth.end_date IS NOT NULL
           AND auth.end_date >= CURRENT_DATE
           AND auth.end_date <= CURRENT_DATE + INTERVAL '30 days'
         ORDER BY auth.end_date ASC`,
        [clinicId]
      ),

      // Visits remaining low (< 3 visits left)
      query(
        `SELECT
           auth.id,
           auth.authorization_number,
           auth.authorized_visits,
           auth.used_visits,
           (auth.authorized_visits - auth.used_visits) AS visits_remaining,
           auth.start_date,
           auth.end_date,
           auth.status,
           p.id AS patient_id,
           p.first_name AS patient_first_name,
           p.last_name AS patient_last_name,
           p.mrn
         FROM authorizations auth
         JOIN patients p ON auth.patient_id = p.id
         WHERE auth.clinic_id = $1
           AND auth.status = 'active'
           AND (auth.authorized_visits - auth.used_visits) < 3
           AND (auth.authorized_visits - auth.used_visits) >= 0
         ORDER BY (auth.authorized_visits - auth.used_visits) ASC`,
        [clinicId]
      ),
    ]);

    const summary = summaryResult.rows[0];

    res.json({
      success: true,
      data: {
        total_active: parseInt(summary.total_active, 10),
        total_expired: parseInt(summary.total_expired, 10),
        expiring_soon: expiringResult.rows,
        visits_remaining_low: lowVisitsResult.rows,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
