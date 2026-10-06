import { Router, Request, Response } from 'express';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// Export patient chart as JSON
router.get('/patient/:patientId/json', requirePermission(Permission.PATIENT_EXPORT), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const patientId = req.params.patientId;

    const includeInternal = req.query.includeInternal === 'true';

    const [patient, notes, appointments, ledger, attachments, insurance, authorizations, hepPrograms, outcomes, internalNotes] = await Promise.all([
      query('SELECT * FROM patients WHERE id = $1 AND clinic_id = $2', [patientId, clinicId]),
      query('SELECT * FROM clinical_notes WHERE patient_id = $1 AND clinic_id = $2 ORDER BY created_at DESC', [patientId, clinicId]),
      query('SELECT * FROM appointments WHERE patient_id = $1 AND clinic_id = $2 ORDER BY start_time DESC', [patientId, clinicId]),
      query('SELECT * FROM ledger_entries WHERE patient_id = $1 AND clinic_id = $2 ORDER BY posted_at DESC', [patientId, clinicId]),
      query('SELECT id, original_filename, mime_type, size_bytes, created_at FROM attachments WHERE patient_id = $1 AND clinic_id = $2', [patientId, clinicId]),
      query('SELECT * FROM insurance WHERE patient_id = $1 AND clinic_id = $2', [patientId, clinicId]),
      query('SELECT * FROM authorizations WHERE patient_id = $1 AND clinic_id = $2 ORDER BY start_date DESC', [patientId, clinicId]),
      query(`SELECT ep.*, COALESCE(
               (SELECT json_agg(json_build_object(
                  'exercise_id', epi.exercise_id, 'sets', epi.sets, 'reps', epi.reps,
                  'hold_seconds', epi.hold_seconds, 'notes', epi.notes, 'sort_order', epi.sort_order
                ) ORDER BY epi.sort_order),
                (SELECT * FROM exercise_program_items epi2 WHERE epi2.program_id = ep.id)),
               '[]'::json) AS items
             FROM exercise_programs ep
             WHERE ep.patient_id = $1 AND ep.clinic_id = $2 AND ep.is_template = false
             ORDER BY ep.created_at DESC`, [patientId, clinicId]).catch(() => ({ rows: [] })),
      query('SELECT * FROM outcome_measures WHERE patient_id = $1 AND clinic_id = $2 ORDER BY administered_date DESC', [patientId, clinicId]).catch(() => ({ rows: [] })),
      includeInternal
        ? query('SELECT * FROM patient_notes WHERE patient_id = $1 AND clinic_id = $2 AND is_active = true ORDER BY is_pinned DESC, created_at DESC', [patientId, clinicId]).catch(() => ({ rows: [] }))
        : Promise.resolve({ rows: [] as unknown[] }),
    ]);

    if (patient.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    const exportData = {
      exportDate: new Date().toISOString(),
      exportVersion: '2.0',
      patient: patient.rows[0],
      insurance: insurance.rows,
      authorizations: authorizations.rows,
      clinicalNotes: notes.rows,
      outcomeMeasures: outcomes.rows,
      hepPrograms: hepPrograms.rows,
      appointments: appointments.rows,
      ledger: ledger.rows,
      attachments: attachments.rows,
      ...(includeInternal ? { internalNotes: internalNotes.rows } : {}),
    };

    await logAudit({
      clinicId,
      userId: req.auth!.userId,
      action: AuditAction.PATIENT_EXPORT,
      resourceType: 'patient',
      resourceId: patientId,
      details: { format: 'json' },
      req,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="patient_${patientId}_export.json"`);
    res.json(exportData);
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Export billing data as CSV
router.get('/billing/csv', requirePermission(Permission.BILLING_EXPORT), async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query;
    let dateFilter = '';
    const params: unknown[] = [req.auth!.clinicId];

    if (fromDate && toDate) {
      dateFilter = ' AND le.service_date >= $2 AND le.service_date <= $3';
      params.push(fromDate, toDate);
    }

    const result = await query(
      `SELECT le.*, p.first_name, p.last_name, p.mrn
       FROM ledger_entries le
       JOIN patients p ON le.patient_id = p.id
       WHERE le.clinic_id = $1${dateFilter}
       ORDER BY le.posted_at DESC`,
      params
    );

    const headers = ['Date', 'MRN', 'Patient Name', 'Type', 'Description', 'CPT', 'Amount', 'Payer', 'Check #'];
    const rows = result.rows.map(r => [
      r.posted_at?.toISOString().substring(0, 10) || '',
      r.mrn,
      `${r.last_name}, ${r.first_name}`,
      r.entry_type,
      r.description,
      r.cpt_code || '',
      (r.amount_cents / 100).toFixed(2),
      r.payer_name || '',
      r.check_number || '',
    ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(','));

    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="billing_export.csv"');
    res.send(csv);
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Export claims list as JSON
router.get('/claims/json', requirePermission(Permission.BILLING_EXPORT), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT c.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
       FROM claims c JOIN patients p ON c.patient_id = p.id
       WHERE c.clinic_id = $1 ORDER BY c.created_at DESC`,
      [req.auth!.clinicId]
    );

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="claims_export.json"');
    res.json({ exportDate: new Date().toISOString(), claims: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Export appointments as CSV (date range filter)
router.get('/appointments/csv', requirePermission(Permission.PATIENT_EXPORT), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const { fromDate, toDate } = req.query;
    let dateFilter = '';
    const params: unknown[] = [clinicId];

    if (fromDate && toDate) {
      dateFilter = ' AND a.start_time >= $2 AND a.start_time <= $3';
      params.push(fromDate, toDate);
    }

    const result = await query(
      `SELECT a.*, p.first_name, p.last_name, p.mrn,
              u.first_name AS therapist_first_name, u.last_name AS therapist_last_name
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       LEFT JOIN users u ON a.therapist_id = u.id
       WHERE a.clinic_id = $1${dateFilter}
       ORDER BY a.start_time DESC`,
      params
    );

    const headers = ['Date', 'Start Time', 'End Time', 'MRN', 'Patient Name', 'Therapist', 'Type', 'Status', 'Notes'];
    const rows = result.rows.map(r => {
      const start = r.start_time ? new Date(r.start_time) : null;
      return [
        start ? start.toISOString().substring(0, 10) : '',
        start ? start.toISOString().substring(11, 16) : '',
        r.end_time ? new Date(r.end_time).toISOString().substring(11, 16) : '',
        r.mrn,
        `${r.last_name}, ${r.first_name}`,
        r.therapist_first_name ? `${r.therapist_last_name}, ${r.therapist_first_name}` : '',
        r.appointment_type,
        r.status,
        (r.notes || '').replace(/\n/g, ' '),
      ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    await logAudit({
      clinicId,
      userId: req.auth!.userId,
      action: AuditAction.PATIENT_EXPORT,
      resourceType: 'appointments',
      details: { format: 'csv', fromDate: fromDate || null, toDate: toDate || null, rowCount: result.rows.length },
      req,
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="appointments_export.csv"');
    res.send(csv);
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
