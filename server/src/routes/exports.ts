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

    const [patient, notes, appointments, ledger, attachments, insurance] = await Promise.all([
      query('SELECT * FROM patients WHERE id = $1 AND clinic_id = $2', [patientId, clinicId]),
      query('SELECT * FROM clinical_notes WHERE patient_id = $1 AND clinic_id = $2 ORDER BY created_at DESC', [patientId, clinicId]),
      query('SELECT * FROM appointments WHERE patient_id = $1 AND clinic_id = $2 ORDER BY start_time DESC', [patientId, clinicId]),
      query('SELECT * FROM ledger_entries WHERE patient_id = $1 AND clinic_id = $2 ORDER BY posted_at DESC', [patientId, clinicId]),
      query('SELECT id, original_filename, mime_type, size_bytes, created_at FROM attachments WHERE patient_id = $1 AND clinic_id = $2', [patientId, clinicId]),
      query('SELECT * FROM insurance WHERE patient_id = $1 AND clinic_id = $2', [patientId, clinicId]),
    ]);

    if (patient.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    const exportData = {
      exportDate: new Date().toISOString(),
      exportVersion: '1.0',
      patient: patient.rows[0],
      insurance: insurance.rows,
      clinicalNotes: notes.rows,
      appointments: appointments.rows,
      ledger: ledger.rows,
      attachments: attachments.rows,
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

export default router;
