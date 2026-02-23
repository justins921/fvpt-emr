import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Generate Statement Data for a Patient ──
router.get('/patient/:patientId', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;

    // Fetch patient info
    const patientResult = await query(
      `SELECT id, first_name, last_name, mrn, address_line1, address_line2, city, state, zip
       FROM patients
       WHERE id = $1 AND clinic_id = $2`,
      [patientId, req.auth!.clinicId]
    );

    if (patientResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    const patient = patientResult.rows[0];

    // Fetch ledger entries grouped by service date
    const ledgerResult = await query(
      `SELECT
         id, entry_type, amount_cents, description, cpt_code,
         service_date, payer_name, posted_at
       FROM ledger_entries
       WHERE clinic_id = $1 AND patient_id = $2
       ORDER BY COALESCE(service_date, posted_at::date) ASC, posted_at ASC`,
      [req.auth!.clinicId, patientId]
    );

    // Build itemized statement with running balance
    let runningBalance = 0;
    const items: Array<{
      date: string;
      description: string;
      charges: number;
      payments: number;
      adjustments: number;
      balance: number;
    }> = [];

    for (const entry of ledgerResult.rows) {
      const date = entry.service_date || new Date(entry.posted_at).toISOString().split('T')[0];
      let charges = 0;
      let payments = 0;
      let adjustments = 0;

      if (entry.entry_type === 'charge') {
        charges = entry.amount_cents;
        runningBalance += entry.amount_cents;
      } else if (entry.entry_type === 'payment') {
        payments = entry.amount_cents;
        runningBalance -= entry.amount_cents;
      } else if (entry.entry_type === 'adjustment' || entry.entry_type === 'write_off') {
        adjustments = entry.amount_cents;
        runningBalance -= entry.amount_cents;
      } else if (entry.entry_type === 'refund') {
        payments = -entry.amount_cents;
        runningBalance += entry.amount_cents;
      }

      items.push({
        date,
        description: entry.description,
        charges,
        payments,
        adjustments,
        balance: runningBalance,
      });
    }

    res.json({
      success: true,
      data: {
        patient: {
          id: patient.id,
          first_name: patient.first_name,
          last_name: patient.last_name,
          mrn: patient.mrn,
          address_line1: patient.address_line1,
          address_line2: patient.address_line2,
          city: patient.city,
          state: patient.state,
          zip: patient.zip,
        },
        statement_date: new Date().toISOString().split('T')[0],
        items,
        total_balance_due: runningBalance,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Generate Statement as Printable HTML ──
router.get('/patient/:patientId/pdf', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;

    // Fetch clinic info
    const clinicResult = await query(
      `SELECT name, address_line1, address_line2, city, state, zip, phone, fax
       FROM clinics
       WHERE id = $1`,
      [req.auth!.clinicId]
    );

    if (clinicResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Clinic not found' });
      return;
    }
    const clinic = clinicResult.rows[0];

    // Fetch patient info
    const patientResult = await query(
      `SELECT id, first_name, last_name, mrn, address_line1, address_line2, city, state, zip
       FROM patients
       WHERE id = $1 AND clinic_id = $2`,
      [patientId, req.auth!.clinicId]
    );

    if (patientResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }
    const patient = patientResult.rows[0];

    // Fetch ledger entries
    const ledgerResult = await query(
      `SELECT entry_type, amount_cents, description, cpt_code, service_date, posted_at
       FROM ledger_entries
       WHERE clinic_id = $1 AND patient_id = $2
       ORDER BY COALESCE(service_date, posted_at::date) ASC, posted_at ASC`,
      [req.auth!.clinicId, patientId]
    );

    // Build items and running balance
    let runningBalance = 0;
    const rows: string[] = [];

    for (const entry of ledgerResult.rows) {
      const date = entry.service_date || new Date(entry.posted_at).toISOString().split('T')[0];
      let charges = '';
      let payments = '';
      let adjustments = '';

      if (entry.entry_type === 'charge') {
        charges = formatCents(entry.amount_cents);
        runningBalance += entry.amount_cents;
      } else if (entry.entry_type === 'payment') {
        payments = formatCents(entry.amount_cents);
        runningBalance -= entry.amount_cents;
      } else if (entry.entry_type === 'adjustment' || entry.entry_type === 'write_off') {
        adjustments = formatCents(entry.amount_cents);
        runningBalance -= entry.amount_cents;
      } else if (entry.entry_type === 'refund') {
        payments = `(${formatCents(entry.amount_cents)})`;
        runningBalance += entry.amount_cents;
      }

      rows.push(`
        <tr>
          <td>${escapeHtml(date)}</td>
          <td>${escapeHtml(entry.description)}</td>
          <td style="text-align:right">${charges}</td>
          <td style="text-align:right">${payments}</td>
          <td style="text-align:right">${adjustments}</td>
          <td style="text-align:right">${formatCents(runningBalance)}</td>
        </tr>
      `);
    }

    const statementDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    const clinicAddress = [
      clinic.address_line1,
      clinic.address_line2,
      `${clinic.city}, ${clinic.state} ${clinic.zip}`,
    ].filter(Boolean).join('<br>');

    const patientAddress = [
      patient.address_line1,
      patient.address_line2,
      patient.city && patient.state ? `${patient.city}, ${patient.state} ${patient.zip}` : null,
    ].filter(Boolean).join('<br>');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Patient Statement</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #333; padding: 40px; }
    .header { display: flex; justify-content: space-between; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 15px; }
    .clinic-info { font-size: 11px; line-height: 1.5; }
    .clinic-name { font-size: 16px; font-weight: bold; margin-bottom: 5px; }
    .statement-title { font-size: 20px; font-weight: bold; text-align: right; }
    .statement-date { text-align: right; margin-top: 5px; font-size: 11px; }
    .patient-info { margin-bottom: 25px; padding: 10px; background: #f9f9f9; border: 1px solid #ddd; }
    .patient-info strong { display: inline-block; width: 50px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #333; color: #fff; padding: 8px 6px; text-align: left; font-size: 11px; }
    th:nth-child(n+3) { text-align: right; }
    td { padding: 6px; border-bottom: 1px solid #eee; font-size: 11px; }
    .total-row { font-weight: bold; border-top: 2px solid #333; }
    .total-row td { padding-top: 10px; font-size: 13px; }
    .footer { margin-top: 30px; font-size: 10px; color: #666; text-align: center; border-top: 1px solid #ddd; padding-top: 10px; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="clinic-info">
      <div class="clinic-name">${escapeHtml(clinic.name)}</div>
      ${clinicAddress}
      ${clinic.phone ? `<br>Phone: ${escapeHtml(clinic.phone)}` : ''}
      ${clinic.fax ? `<br>Fax: ${escapeHtml(clinic.fax)}` : ''}
    </div>
    <div>
      <div class="statement-title">PATIENT STATEMENT</div>
      <div class="statement-date">Date: ${statementDate}</div>
    </div>
  </div>

  <div class="patient-info">
    <strong>Name:</strong> ${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name)}<br>
    <strong>MRN:</strong> ${escapeHtml(patient.mrn)}<br>
    ${patientAddress ? `<strong>Addr:</strong> ${patientAddress}` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Description</th>
        <th>Charges</th>
        <th>Payments</th>
        <th>Adjustments</th>
        <th>Balance</th>
      </tr>
    </thead>
    <tbody>
      ${rows.join('')}
      <tr class="total-row">
        <td colspan="5" style="text-align:right">Total Balance Due:</td>
        <td style="text-align:right">${formatCents(runningBalance)}</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    This statement reflects charges, payments, and adjustments as of ${statementDate}.<br>
    Please contact our office with any billing questions.
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `inline; filename="statement_${patient.mrn}_${new Date().toISOString().split('T')[0]}.html"`);
    res.send(html);
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Batch Generate Statements ──
router.post('/batch', requirePermission(Permission.BILLING_VIEW), async (req: Request, res: Response) => {
  try {
    // Find all patients with outstanding balances
    const result = await query(
      `SELECT
         le.patient_id,
         p.first_name,
         p.last_name,
         p.mrn,
         SUM(CASE WHEN le.entry_type = 'charge' THEN le.amount_cents ELSE 0 END) as total_charges,
         SUM(CASE WHEN le.entry_type = 'payment' THEN le.amount_cents ELSE 0 END) as total_payments,
         SUM(CASE WHEN le.entry_type IN ('adjustment', 'write_off') THEN le.amount_cents ELSE 0 END) as total_adjustments,
         SUM(CASE WHEN le.entry_type = 'refund' THEN le.amount_cents ELSE 0 END) as total_refunds
       FROM ledger_entries le
       JOIN patients p ON le.patient_id = p.id AND p.clinic_id = le.clinic_id
       WHERE le.clinic_id = $1
       GROUP BY le.patient_id, p.first_name, p.last_name, p.mrn
       HAVING (
         SUM(CASE WHEN le.entry_type = 'charge' THEN le.amount_cents ELSE 0 END)
         - SUM(CASE WHEN le.entry_type = 'payment' THEN le.amount_cents ELSE 0 END)
         - SUM(CASE WHEN le.entry_type IN ('adjustment', 'write_off') THEN le.amount_cents ELSE 0 END)
         + SUM(CASE WHEN le.entry_type = 'refund' THEN le.amount_cents ELSE 0 END)
       ) > 0
       ORDER BY p.last_name, p.first_name`,
      [req.auth!.clinicId]
    );

    const statements = result.rows.map(row => ({
      patient_id: row.patient_id,
      first_name: row.first_name,
      last_name: row.last_name,
      mrn: row.mrn,
      balance_cents: (
        parseInt(row.total_charges, 10)
        - parseInt(row.total_payments, 10)
        - parseInt(row.total_adjustments, 10)
        + parseInt(row.total_refunds, 10)
      ),
    }));

    res.json({
      success: true,
      data: {
        statement_date: new Date().toISOString().split('T')[0],
        count: statements.length,
        statements,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Helpers ──

function formatCents(cents: number): string {
  const dollars = (cents / 100).toFixed(2);
  return `$${dollars}`;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default router;
