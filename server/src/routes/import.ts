import { Router, Request, Response } from 'express';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query, transaction } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';
import { v4 as uuid } from 'uuid';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Simple CSV parser (no external deps) ──
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// ── Field mapping: Practice Perfect → EMR OS ──
interface FieldMapping {
  [ppField: string]: string; // ppField → our field
}

const PATIENT_FIELD_MAP: FieldMapping = {
  // Practice Perfect common exports
  'Client ID': 'external_id',
  'ClientID': 'external_id',
  'client_id': 'external_id',
  'Account #': 'external_id',
  'Account Number': 'external_id',
  'First Name': 'first_name',
  'FirstName': 'first_name',
  'first_name': 'first_name',
  'Last Name': 'last_name',
  'LastName': 'last_name',
  'last_name': 'last_name',
  'Date of Birth': 'date_of_birth',
  'DOB': 'date_of_birth',
  'dob': 'date_of_birth',
  'Birth Date': 'date_of_birth',
  'Gender': 'gender',
  'Sex': 'gender',
  'gender': 'gender',
  'Phone': 'phone',
  'Home Phone': 'phone',
  'Phone Number': 'phone',
  'phone': 'phone',
  'Cell Phone': 'phone',
  'Mobile': 'phone',
  'Email': 'email',
  'email': 'email',
  'E-Mail': 'email',
  'Address': 'address_line1',
  'Address Line 1': 'address_line1',
  'Street': 'address_line1',
  'address': 'address_line1',
  'Address Line 2': 'address_line2',
  'Apt': 'address_line2',
  'City': 'city',
  'city': 'city',
  'State': 'state',
  'Province': 'state',
  'state': 'state',
  'Zip': 'zip',
  'Zip Code': 'zip',
  'Postal Code': 'zip',
  'zip': 'zip',
  'Emergency Contact': 'emergency_contact_name',
  'Emergency Contact Name': 'emergency_contact_name',
  'Emergency Phone': 'emergency_contact_phone',
  'Emergency Contact Phone': 'emergency_contact_phone',
  'Diagnosis': 'primary_diagnosis_icd10',
  'Primary Diagnosis': 'primary_diagnosis_icd10',
  'ICD-10': 'primary_diagnosis_icd10',
  'ICD10': 'primary_diagnosis_icd10',
  'Dx Code': 'primary_diagnosis_icd10',
  'Referring Physician': 'referring_provider',
  'Referring Provider': 'referring_provider',
  'Referring Dr': 'referring_provider',
  'Referral Source': 'referral_source',
  'Payer': 'payer_name',
  'Insurance': 'payer_name',
  'Insurance Company': 'payer_name',
  'Insurance Name': 'payer_name',
  'Member ID': 'member_id',
  'Policy Number': 'member_id',
  'Policy #': 'member_id',
  'Group Number': 'group_number',
  'Group #': 'group_number',
  'Group': 'group_number',
  'MRN': 'mrn',
  'Medical Record Number': 'mrn',
  'Precautions': 'precautions',
  'Alerts': 'precautions',
  'Notes': 'precautions',
  'Status': 'status',
  'Active': 'status',
};

const APPOINTMENT_FIELD_MAP: FieldMapping = {
  // Date fields
  'Date': 'date',
  'Appointment Date': 'date',
  'Appt Date': 'date',
  'Visit Date': 'date',
  'Service Date': 'date',
  'date': 'date',
  // Time fields
  'Start Time': 'start_time',
  'Time': 'start_time',
  'Appt Time': 'start_time',
  'Start': 'start_time',
  'start_time': 'start_time',
  'End Time': 'end_time',
  'End': 'end_time',
  'end_time': 'end_time',
  // Duration
  'Duration': 'duration',
  'Length': 'duration',
  'Minutes': 'duration',
  'duration': 'duration',
  // Patient identification
  'Patient': 'patient_name',
  'Patient Name': 'patient_name',
  'Client': 'patient_name',
  'Client Name': 'patient_name',
  'Patient First Name': 'patient_first_name',
  'Patient FirstName': 'patient_first_name',
  'Client First Name': 'patient_first_name',
  'Patient Last Name': 'patient_last_name',
  'Patient LastName': 'patient_last_name',
  'Client Last Name': 'patient_last_name',
  // Provider / therapist
  'Therapist': 'therapist_name',
  'Provider': 'therapist_name',
  'Clinician': 'therapist_name',
  'Practitioner': 'therapist_name',
  'Treating Therapist': 'therapist_name',
  'Staff': 'therapist_name',
  'Therapist Name': 'therapist_name',
  'Provider Name': 'therapist_name',
  // Type
  'Type': 'appointment_type',
  'Appointment Type': 'appointment_type',
  'Visit Type': 'appointment_type',
  'Appt Type': 'appointment_type',
  'Service': 'appointment_type',
  // Status
  'Status': 'appt_status',
  'Appt Status': 'appt_status',
  'Appointment Status': 'appt_status',
  // Notes
  'Notes': 'notes',
  'Comments': 'notes',
  'Appointment Notes': 'notes',
  'Note': 'notes',
  // MRN for patient matching
  'MRN': 'mrn',
  'Account #': 'mrn',
  'Client ID': 'mrn',
};

const INSURANCE_FIELD_MAP: FieldMapping = {
  'MRN': 'mrn',
  'Medical Record Number': 'mrn',
  'Client ID': 'mrn',
  'Account #': 'mrn',
  'mrn': 'mrn',
  'Patient First Name': 'patient_first_name',
  'Patient Last Name': 'patient_last_name',
  'First Name': 'patient_first_name',
  'Last Name': 'patient_last_name',
  'Date of Birth': 'date_of_birth',
  'DOB': 'date_of_birth',
  'dob': 'date_of_birth',
  'Payer': 'payer_name',
  'Insurance': 'payer_name',
  'Insurance Company': 'payer_name',
  'Insurance Name': 'payer_name',
  'Payer Name': 'payer_name',
  'payer_name': 'payer_name',
  'Plan Name': 'plan_name',
  'Plan': 'plan_name',
  'Member ID': 'member_id',
  'Policy Number': 'member_id',
  'Policy #': 'member_id',
  'MemberID': 'member_id',
  'member_id': 'member_id',
  'Group Number': 'group_number',
  'Group #': 'group_number',
  'Group': 'group_number',
  'Subscriber Name': 'subscriber_name',
  'Subscriber': 'subscriber_name',
  'Subscriber DOB': 'subscriber_dob',
  'Subscriber Date of Birth': 'subscriber_dob',
  'Relationship': 'subscriber_relationship',
  'Subscriber Relationship': 'subscriber_relationship',
  'Coverage Start': 'coverage_start',
  'Effective Date': 'coverage_start',
  'Start Date': 'coverage_start',
  'Coverage End': 'coverage_end',
  'Termination Date': 'coverage_end',
  'End Date': 'coverage_end',
  'Type': 'insurance_type',
  'Insurance Type': 'insurance_type',
  'Primary': 'is_primary',
  'Is Primary': 'is_primary',
};

const AUTHORIZATION_FIELD_MAP: FieldMapping = {
  'MRN': 'mrn',
  'Medical Record Number': 'mrn',
  'Client ID': 'mrn',
  'Account #': 'mrn',
  'mrn': 'mrn',
  'Patient First Name': 'patient_first_name',
  'Patient Last Name': 'patient_last_name',
  'First Name': 'patient_first_name',
  'Last Name': 'patient_last_name',
  'Date of Birth': 'date_of_birth',
  'DOB': 'date_of_birth',
  'Payer': 'payer_name',
  'Insurance': 'payer_name',
  'Insurance Company': 'payer_name',
  'Payer Name': 'payer_name',
  'payer_name': 'payer_name',
  'Auth Number': 'authorization_number',
  'Authorization Number': 'authorization_number',
  'Authorization #': 'authorization_number',
  'Auth #': 'authorization_number',
  'authorization_number': 'authorization_number',
  'Visits Authorized': 'authorized_visits',
  'Authorized Visits': 'authorized_visits',
  'Visits': 'authorized_visits',
  'Number of Visits': 'authorized_visits',
  'Visits Used': 'used_visits',
  'Used Visits': 'used_visits',
  'Start Date': 'start_date',
  'Auth Start': 'start_date',
  'Effective Date': 'start_date',
  'End Date': 'end_date',
  'Auth End': 'end_date',
  'Expiration Date': 'end_date',
  'Expiry': 'end_date',
  'Status': 'status',
  'Auth Status': 'status',
  'Notes': 'notes',
  'Auth Notes': 'notes',
};

function normalizeDate(val: string): string | null {
  if (!val) return null;
  // Try ISO format first
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.substring(0, 10);
  // MM/DD/YYYY
  const mdy = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  // DD-MM-YYYY
  const dmy = val.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return null;
}

function normalizeGender(val: string): string {
  const v = val.toLowerCase().trim();
  if (v === 'm' || v === 'male') return 'male';
  if (v === 'f' || v === 'female') return 'female';
  return 'other';
}

function mapRow(row: Record<string, string>, fieldMap: FieldMapping): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [csvField, value] of Object.entries(row)) {
    const ourField = fieldMap[csvField];
    if (ourField && value) {
      mapped[ourField] = value;
    }
  }
  return mapped;
}

// Parse time strings like "9:00 AM", "14:30", "2:30 PM"
function normalizeTime(val: string): string | null {
  if (!val) return null;
  const v = val.trim();
  // 24-hour format: 14:30
  const h24 = v.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) return `${h24[1].padStart(2, '0')}:${h24[2]}`;
  // 12-hour format: 2:30 PM
  const h12 = v.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a|p)$/i);
  if (h12) {
    let hour = parseInt(h12[1], 10);
    const ampm = h12[3].toUpperCase();
    if ((ampm === 'PM' || ampm === 'P') && hour < 12) hour += 12;
    if ((ampm === 'AM' || ampm === 'A') && hour === 12) hour = 0;
    return `${hour.toString().padStart(2, '0')}:${h12[2]}`;
  }
  return null;
}

function normalizeAppointmentType(val: string): string {
  const v = val.toLowerCase().trim();
  if (v.includes('eval') || v.includes('initial') || v.includes('ie') || v === 'new') return 'evaluation';
  if (v.includes('re-eval') || v.includes('reeval') || v.includes('re eval')) return 're_evaluation';
  if (v.includes('discharge') || v.includes('dc') || v.includes('final')) return 'discharge';
  return 'follow_up';
}

function normalizeAppointmentStatus(val: string): string {
  const v = val.toLowerCase().trim();
  if (v.includes('complete') || v.includes('attended') || v.includes('kept') || v === 'done') return 'completed';
  if (v.includes('cancel')) return 'cancelled';
  if (v.includes('no show') || v.includes('no-show') || v.includes('noshow') || v === 'ns') return 'no_show';
  if (v.includes('check') || v.includes('arrived')) return 'checked_in';
  if (v.includes('progress') || v.includes('treating')) return 'in_progress';
  return 'scheduled';
}

// Parse a combined "Last, First" name
function splitFullName(fullName: string): { first: string; last: string } | null {
  if (!fullName) return null;
  // Try "Last, First" format
  if (fullName.includes(',')) {
    const parts = fullName.split(',').map(s => s.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) return { first: parts[1], last: parts[0] };
  }
  // Try "First Last" format
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) return { first: parts[0], last: parts.slice(1).join(' ') };
  return null;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

// ── Preview endpoint (dry run) ──
router.post('/preview', requirePermission(Permission.DATA_IMPORT), async (req: Request, res: Response) => {
  try {
    const { csv, type } = req.body;
    if (!csv || typeof csv !== 'string') {
      res.status(400).json({ success: false, error: 'CSV data is required' });
      return;
    }
    if (!['patients', 'appointments', 'insurance', 'authorizations'].includes(type)) {
      res.status(400).json({ success: false, error: 'Import type must be "patients", "appointments", "insurance", or "authorizations"' });
      return;
    }

    const fieldMap =
      type === 'patients' ? PATIENT_FIELD_MAP :
      type === 'appointments' ? APPOINTMENT_FIELD_MAP :
      type === 'insurance' ? INSURANCE_FIELD_MAP :
      AUTHORIZATION_FIELD_MAP;
    const rows = parseCSV(csv);
    if (rows.length === 0) {
      res.status(400).json({ success: false, error: 'No data rows found in CSV' });
      return;
    }

    const headers = Object.keys(rows[0]);
    const mappedFields = headers.filter(h => fieldMap[h]).map(h => ({
      csvField: h,
      mapsTo: fieldMap[h],
    }));
    const unmappedFields = headers.filter(h => !fieldMap[h]);
    const preview = rows.slice(0, 5).map(row => mapRow(row, fieldMap));

    const errors: Array<{ row: number; reason: string }> = [];
    let validCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const mapped = mapRow(rows[i], fieldMap);
      if (type === 'patients') {
        if (!mapped.first_name || !mapped.last_name) {
          errors.push({ row: i + 2, reason: 'Missing first or last name' });
        } else if (mapped.date_of_birth && !normalizeDate(mapped.date_of_birth)) {
          errors.push({ row: i + 2, reason: `Invalid date format: "${mapped.date_of_birth}"` });
        } else {
          validCount++;
        }
      } else if (type === 'insurance') {
        const hasPatient = mapped.mrn || (mapped.patient_first_name && mapped.patient_last_name);
        if (!hasPatient) {
          errors.push({ row: i + 2, reason: 'Missing patient identifier (MRN or name)' });
        } else if (!mapped.payer_name) {
          errors.push({ row: i + 2, reason: 'Missing payer/insurance name' });
        } else if (!mapped.member_id) {
          errors.push({ row: i + 2, reason: 'Missing member ID' });
        } else if (mapped.subscriber_dob && !normalizeDate(mapped.subscriber_dob)) {
          errors.push({ row: i + 2, reason: `Invalid subscriber DOB: "${mapped.subscriber_dob}"` });
        } else if (mapped.coverage_start && !normalizeDate(mapped.coverage_start)) {
          errors.push({ row: i + 2, reason: `Invalid coverage start date: "${mapped.coverage_start}"` });
        } else {
          validCount++;
        }
      } else if (type === 'authorizations') {
        const hasPatient = mapped.mrn || (mapped.patient_first_name && mapped.patient_last_name);
        if (!hasPatient) {
          errors.push({ row: i + 2, reason: 'Missing patient identifier (MRN or name)' });
        } else if (!mapped.authorized_visits || isNaN(parseInt(mapped.authorized_visits, 10))) {
          errors.push({ row: i + 2, reason: 'Missing or invalid visits authorized' });
        } else if (!mapped.start_date || !normalizeDate(mapped.start_date)) {
          errors.push({ row: i + 2, reason: `Missing or invalid start date: "${mapped.start_date || ''}"` });
        } else if (mapped.end_date && !normalizeDate(mapped.end_date)) {
          errors.push({ row: i + 2, reason: `Invalid end date: "${mapped.end_date}"` });
        } else {
          validCount++;
        }
      } else {
        // Appointment validation
        const hasPatient = mapped.patient_name || (mapped.patient_first_name && mapped.patient_last_name) || mapped.mrn;
        const hasDate = mapped.date;
        const hasTime = mapped.start_time;
        if (!hasPatient) {
          errors.push({ row: i + 2, reason: 'Missing patient identifier (name or MRN)' });
        } else if (!hasDate) {
          errors.push({ row: i + 2, reason: 'Missing appointment date' });
        } else if (hasDate && !normalizeDate(mapped.date)) {
          errors.push({ row: i + 2, reason: `Invalid date format: "${mapped.date}"` });
        } else if (hasTime && !normalizeTime(mapped.start_time)) {
          errors.push({ row: i + 2, reason: `Invalid time format: "${mapped.start_time}"` });
        } else {
          validCount++;
        }
      }
    }

    res.json({
      success: true,
      data: {
        totalRows: rows.length,
        validRows: validCount,
        mappedFields,
        unmappedFields,
        preview,
        errors: errors.slice(0, 20),
      },
    });
  } catch (err) {
    console.error('Import preview error:', err);
    res.status(500).json({ success: false, error: 'Failed to parse CSV' });
  }
});

// ── Execute import ──
router.post('/patients', requirePermission(Permission.DATA_IMPORT), async (req: Request, res: Response) => {
  try {
    const { csv, duplicateHandling = 'skip' } = req.body;
    const clinicId = req.auth!.clinicId;

    if (!csv || typeof csv !== 'string') {
      res.status(400).json({ success: false, error: 'CSV data is required' });
      return;
    }

    const rows = parseCSV(csv);
    if (rows.length === 0) {
      res.status(400).json({ success: false, error: 'No data rows found' });
      return;
    }

    const result = await transaction<ImportResult>(async (client) => {
      let imported = 0;
      let skipped = 0;
      const errors: Array<{ row: number; reason: string }> = [];

      for (let i = 0; i < rows.length; i++) {
        const mapped = mapRow(rows[i], PATIENT_FIELD_MAP);

        if (!mapped.first_name || !mapped.last_name) {
          errors.push({ row: i + 2, reason: 'Missing first or last name' });
          continue;
        }

        const dob = mapped.date_of_birth ? normalizeDate(mapped.date_of_birth) : null;
        if (mapped.date_of_birth && !dob) {
          errors.push({ row: i + 2, reason: `Invalid date: "${mapped.date_of_birth}"` });
          continue;
        }

        // Check for duplicates by name + DOB
        if (dob) {
          const existing = await client.query(
            `SELECT id FROM patients WHERE clinic_id = $1 AND LOWER(first_name) = LOWER($2) AND LOWER(last_name) = LOWER($3) AND date_of_birth = $4`,
            [clinicId, mapped.first_name, mapped.last_name, dob]
          );
          if (existing.rows.length > 0) {
            if (duplicateHandling === 'skip') {
              skipped++;
              continue;
            }
            // duplicateHandling === 'update': update existing record
            if (duplicateHandling === 'update') {
              await client.query(
                `UPDATE patients SET
                  phone = COALESCE($1, phone),
                  email = COALESCE($2, email),
                  address_line1 = COALESCE($3, address_line1),
                  city = COALESCE($4, city),
                  state = COALESCE($5, state),
                  zip = COALESCE($6, zip),
                  emergency_contact_name = COALESCE($7, emergency_contact_name),
                  emergency_contact_phone = COALESCE($8, emergency_contact_phone),
                  primary_diagnosis_icd10 = COALESCE($9, primary_diagnosis_icd10),
                  referring_provider = COALESCE($10, referring_provider),
                  referral_source = COALESCE($11, referral_source),
                  precautions = COALESCE($12, precautions),
                  updated_at = NOW()
                WHERE id = $13`,
                [
                  mapped.phone || null, mapped.email || null,
                  mapped.address_line1 || null, mapped.city || null,
                  mapped.state || null, mapped.zip || null,
                  mapped.emergency_contact_name || null, mapped.emergency_contact_phone || null,
                  mapped.primary_diagnosis_icd10 || null, mapped.referring_provider || null,
                  mapped.referral_source || null, mapped.precautions || null,
                  existing.rows[0].id,
                ]
              );
              imported++;
              continue;
            }
          }
        }

        // Generate MRN
        const mrn = mapped.mrn || `PP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const gender = mapped.gender ? normalizeGender(mapped.gender) : 'other';
        const isActive = mapped.status
          ? !['inactive', 'discharged', 'closed', 'no'].includes(mapped.status.toLowerCase())
          : true;

        // Insert patient
        const patientId = uuid();
        await client.query(
          `INSERT INTO patients (id, clinic_id, mrn, first_name, last_name, date_of_birth, gender,
            phone, email, address_line1, address_line2, city, state, zip,
            emergency_contact_name, emergency_contact_phone,
            primary_diagnosis_icd10, referring_provider, referral_source, precautions, is_active)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [
            patientId, clinicId, mrn,
            mapped.first_name, mapped.last_name, dob || '1900-01-01', gender,
            mapped.phone || null, mapped.email || null,
            mapped.address_line1 || null, mapped.address_line2 || null,
            mapped.city || null, mapped.state || null, mapped.zip || null,
            mapped.emergency_contact_name || null, mapped.emergency_contact_phone || null,
            mapped.primary_diagnosis_icd10 || null, mapped.referring_provider || null,
            mapped.referral_source || null, mapped.precautions || null, isActive,
          ]
        );

        // If insurance info was provided, create insurance record
        if (mapped.payer_name) {
          await client.query(
            `INSERT INTO insurance (clinic_id, patient_id, payer_name, payer_id, member_id, group_number,
              subscriber_name, subscriber_dob, subscriber_relationship, coverage_start, is_primary)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'self',$9,true)`,
            [
              clinicId, patientId, mapped.payer_name,
              mapped.payer_name.substring(0, 20).replace(/\s/g, '').toUpperCase(),
              mapped.member_id || 'PENDING',
              mapped.group_number || null,
              `${mapped.first_name} ${mapped.last_name}`,
              dob || '1900-01-01',
              new Date().toISOString().substring(0, 10),
            ]
          );
        }

        imported++;
      }

      return { imported, skipped, errors };
    });

    await logAudit({
      clinicId,
      userId: req.auth!.userId,
      action: AuditAction.DATA_IMPORT,
      resourceType: 'patients',
      details: {
        source: 'practice_perfect',
        totalRows: rows.length,
        imported: result.imported,
        skipped: result.skipped,
        errorCount: result.errors.length,
      },
      req,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ success: false, error: 'Import failed. All changes have been rolled back.' });
  }
});

// ── Import appointments ──
router.post('/appointments', requirePermission(Permission.DATA_IMPORT), async (req: Request, res: Response) => {
  try {
    const { csv, defaultDuration = 45 } = req.body;
    const clinicId = req.auth!.clinicId;

    if (!csv || typeof csv !== 'string') {
      res.status(400).json({ success: false, error: 'CSV data is required' });
      return;
    }

    const rows = parseCSV(csv);
    if (rows.length === 0) {
      res.status(400).json({ success: false, error: 'No data rows found' });
      return;
    }

    // Pre-load patients and therapists for matching
    const patientsResult = await query(
      `SELECT id, mrn, LOWER(first_name) as first_name, LOWER(last_name) as last_name FROM patients WHERE clinic_id = $1`,
      [clinicId]
    );
    const therapistsResult = await query(
      `SELECT id, LOWER(first_name) as first_name, LOWER(last_name) as last_name FROM users WHERE clinic_id = $1 AND is_active = true AND role IN ('therapist', 'owner', 'admin', 'dev')`,
      [clinicId]
    );

    const patientsByMrn = new Map<string, string>();
    const patientsByName = new Map<string, string>();
    for (const p of patientsResult.rows) {
      if (p.mrn) patientsByMrn.set(p.mrn.toLowerCase(), p.id);
      patientsByName.set(`${p.first_name}|${p.last_name}`, p.id);
    }

    const therapistsByName = new Map<string, string>();
    for (const t of therapistsResult.rows) {
      therapistsByName.set(`${t.first_name}|${t.last_name}`, t.id);
      // Also map by last name only for partial matching
      therapistsByName.set(`|${t.last_name}`, t.id);
    }

    // Use first therapist as fallback
    const fallbackTherapistId = therapistsResult.rows[0]?.id;
    if (!fallbackTherapistId) {
      res.status(400).json({ success: false, error: 'No active therapists found in the clinic. Import patients and create users first.' });
      return;
    }

    const result = await transaction<ImportResult>(async (client) => {
      let imported = 0;
      let skipped = 0;
      const errors: Array<{ row: number; reason: string }> = [];

      for (let i = 0; i < rows.length; i++) {
        const mapped = mapRow(rows[i], APPOINTMENT_FIELD_MAP);

        // Resolve patient
        let patientId: string | null = null;

        if (mapped.mrn) {
          patientId = patientsByMrn.get(mapped.mrn.toLowerCase()) || null;
        }

        if (!patientId) {
          let firstName = mapped.patient_first_name?.toLowerCase();
          let lastName = mapped.patient_last_name?.toLowerCase();

          if (!firstName || !lastName) {
            const parsed = splitFullName(mapped.patient_name || '');
            if (parsed) {
              firstName = parsed.first.toLowerCase();
              lastName = parsed.last.toLowerCase();
            }
          }

          if (firstName && lastName) {
            patientId = patientsByName.get(`${firstName}|${lastName}`) || null;
          }
        }

        if (!patientId) {
          errors.push({ row: i + 2, reason: `Patient not found: "${mapped.patient_name || mapped.patient_first_name + ' ' + mapped.patient_last_name || mapped.mrn}". Import patients first.` });
          continue;
        }

        // Resolve therapist
        let therapistId = fallbackTherapistId;
        if (mapped.therapist_name) {
          const parsed = splitFullName(mapped.therapist_name);
          if (parsed) {
            const match = therapistsByName.get(`${parsed.first.toLowerCase()}|${parsed.last.toLowerCase()}`)
              || therapistsByName.get(`|${parsed.last.toLowerCase()}`);
            if (match) therapistId = match;
          }
        }

        // Parse date and time
        const apptDate = normalizeDate(mapped.date || '');
        if (!apptDate) {
          errors.push({ row: i + 2, reason: `Invalid date: "${mapped.date}"` });
          continue;
        }

        const startTime = normalizeTime(mapped.start_time || '') || '09:00';
        const duration = parseInt(mapped.duration || '', 10) || defaultDuration;

        const startDateTime = new Date(`${apptDate}T${startTime}:00`);
        if (isNaN(startDateTime.getTime())) {
          errors.push({ row: i + 2, reason: `Invalid date/time: "${apptDate} ${startTime}"` });
          continue;
        }

        let endDateTime: Date;
        if (mapped.end_time) {
          const endTime = normalizeTime(mapped.end_time);
          if (endTime) {
            endDateTime = new Date(`${apptDate}T${endTime}:00`);
          } else {
            endDateTime = new Date(startDateTime.getTime() + duration * 60000);
          }
        } else {
          endDateTime = new Date(startDateTime.getTime() + duration * 60000);
        }

        const appointmentType = mapped.appointment_type ? normalizeAppointmentType(mapped.appointment_type) : 'follow_up';
        const status = mapped.appt_status ? normalizeAppointmentStatus(mapped.appt_status) : 'completed';

        await client.query(
          `INSERT INTO appointments (clinic_id, patient_id, therapist_id, start_time, end_time, appointment_type, status, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            clinicId, patientId, therapistId,
            startDateTime.toISOString(), endDateTime.toISOString(),
            appointmentType, status, mapped.notes || null,
          ]
        );

        imported++;
      }

      return { imported, skipped, errors };
    });

    await logAudit({
      clinicId,
      userId: req.auth!.userId,
      action: AuditAction.DATA_IMPORT,
      resourceType: 'appointments',
      details: {
        source: 'practice_perfect',
        totalRows: rows.length,
        imported: result.imported,
        skipped: result.skipped,
        errorCount: result.errors.length,
      },
      req,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Appointment import error:', err);
    res.status(500).json({ success: false, error: 'Import failed. All changes have been rolled back.' });
  }
});


// ── Shared patient matching for insurance/auth imports ──
async function buildPatientMatcher(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  clinicId: string
): Promise<{
  byMrn: Map<string, string>;
  byNameDob: Map<string, string>;
  byName: Map<string, string>;
  dobById: Map<string, string>;
}> {
  const res = await client.query(
    `SELECT id, mrn, LOWER(first_name) as first_name, LOWER(last_name) as last_name,
            date_of_birth::text as dob
     FROM patients WHERE clinic_id = $1`,
    [clinicId]
  );
  const byMrn = new Map<string, string>();
  const byNameDob = new Map<string, string>();
  const byName = new Map<string, string>();
  const dobById = new Map<string, string>();
  for (const p of res.rows) {
    const id = p.id as string;
    if (p.mrn) byMrn.set(String(p.mrn).toLowerCase(), id);
    byName.set(`${p.first_name}|${p.last_name}`, id);
    if (p.dob) {
      byNameDob.set(`${p.first_name}|${p.last_name}|${p.dob}`, id);
      dobById.set(id, p.dob as string);
    }
  }
  return { byMrn, byNameDob, byName, dobById };
}

function matchPatient(
  mapped: Record<string, string>,
  matcher: { byMrn: Map<string, string>; byNameDob: Map<string, string>; byName: Map<string, string> },
  dob?: string | null
): string | null {
  if (mapped.mrn) {
    const hit = matcher.byMrn.get(mapped.mrn.toLowerCase());
    if (hit) return hit;
  }
  const first = (mapped.patient_first_name || '').toLowerCase();
  const last = (mapped.patient_last_name || '').toLowerCase();
  if (first && last) {
    if (dob) {
      const hit = matcher.byNameDob.get(`${first}|${last}|${dob}`);
      if (hit) return hit;
    }
    const hit = matcher.byName.get(`${first}|${last}`);
    if (hit) return hit;
  }
  return null;
}

function normalizeInsuranceType(val: string): 'primary' | 'secondary' {
  const v = val.toLowerCase().trim();
  if (v.includes('second') || v === '2' || v.includes('sec')) return 'secondary';
  return 'primary';
}

function normalizeAuthStatus(val: string): string {
  const v = val.toLowerCase().trim();
  if (v.includes('expir')) return 'expired';
  if (v.includes('exhaust')) return 'exhausted';
  if (v.includes('pend')) return 'pending';
  if (v.includes('den')) return 'denied';
  return 'active';
}

// ── Import insurance records ──
router.post('/insurance', requirePermission(Permission.DATA_IMPORT), async (req: Request, res: Response) => {
  try {
    const { csv, duplicateHandling = 'skip' } = req.body;
    const clinicId = req.auth!.clinicId;

    if (!csv || typeof csv !== 'string') {
      res.status(400).json({ success: false, error: 'CSV data is required' });
      return;
    }

    const rows = parseCSV(csv);
    if (rows.length === 0) {
      res.status(400).json({ success: false, error: 'No data rows found' });
      return;
    }

    const result = await transaction<ImportResult>(async (client) => {
      let imported = 0;
      let skipped = 0;
      let updated = 0;
      const errors: Array<{ row: number; reason: string }> = [];
      const matcher = await buildPatientMatcher(client, clinicId);

      for (let i = 0; i < rows.length; i++) {
        const mapped = mapRow(rows[i], INSURANCE_FIELD_MAP);

        const dob = mapped.date_of_birth ? normalizeDate(mapped.date_of_birth) : null;
        const patientId = matchPatient(mapped, matcher, dob);
        if (!patientId) {
          errors.push({ row: i + 2, reason: `Patient not found: "${mapped.mrn || (mapped.patient_first_name + ' ' + mapped.patient_last_name)}". Import patients first.` });
          continue;
        }
        if (!mapped.payer_name || !mapped.member_id) {
          errors.push({ row: i + 2, reason: 'Missing payer name or member ID' });
          continue;
        }

        const subDob = mapped.subscriber_dob ? normalizeDate(mapped.subscriber_dob) : null;
        if (mapped.subscriber_dob && !subDob) {
          errors.push({ row: i + 2, reason: `Invalid subscriber DOB: "${mapped.subscriber_dob}"` });
          continue;
        }
        const coverageStart = mapped.coverage_start ? normalizeDate(mapped.coverage_start) : null;
        if (mapped.coverage_start && !coverageStart) {
          errors.push({ row: i + 2, reason: `Invalid coverage start: "${mapped.coverage_start}"` });
          continue;
        }
        const coverageEnd = mapped.coverage_end ? normalizeDate(mapped.coverage_end) : null;
        if (mapped.coverage_end && !coverageEnd) {
          errors.push({ row: i + 2, reason: `Invalid coverage end: "${mapped.coverage_end}"` });
          continue;
        }

        // Duplicate check: same patient + payer + member ID
        const existing = await client.query(
          `SELECT id FROM insurance WHERE clinic_id = $1 AND patient_id = $2
           AND LOWER(payer_name) = LOWER($3) AND member_id = $4 AND is_active = true`,
          [clinicId, patientId, mapped.payer_name, mapped.member_id]
        );
        if (existing.rows.length > 0) {
          if (duplicateHandling === 'skip') {
            skipped++;
            continue;
          }
          // update: refresh group/coverage fields, keep identity columns
          await client.query(
            `UPDATE insurance SET group_number = COALESCE($1, group_number),
              plan_name = COALESCE($2, plan_name),
              coverage_start = COALESCE($3, coverage_start),
              coverage_end = COALESCE($4, coverage_end),
              subscriber_name = COALESCE($5, subscriber_name),
              updated_at = NOW()
             WHERE id = $6`,
            [
              mapped.group_number || null, mapped.plan_name || null,
              coverageStart, coverageEnd,
              mapped.subscriber_name || null, existing.rows[0].id,
            ]
          );
          updated++;
          continue;
        }

        const insType = normalizeInsuranceType(mapped.insurance_type || '');
        const patientDob = matcher.dobById.get(patientId) || '1900-01-01';
        await client.query(
          `INSERT INTO insurance (clinic_id, patient_id, payer_name, payer_id, plan_name, member_id,
            group_number, subscriber_name, subscriber_dob, subscriber_relationship,
            coverage_start, coverage_end, is_primary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            clinicId, patientId, mapped.payer_name,
            mapped.payer_name.substring(0, 20).replace(/\s/g, '').toUpperCase(),
            mapped.plan_name || null, mapped.member_id,
            mapped.group_number || null,
            mapped.subscriber_name || null, subDob || patientDob,
            'self',
            coverageStart || new Date().toISOString().substring(0, 10), coverageEnd,
            insType === 'primary',
          ]
        );
        imported++;
      }

      return { imported, skipped, errors, updated };
    });

    await logAudit({
      clinicId,
      userId: req.auth!.userId,
      action: AuditAction.DATA_IMPORT,
      resourceType: 'insurance',
      details: {
        source: 'practice_perfect',
        totalRows: rows.length,
        imported: (result as ImportResult & { updated: number }).imported,
        skipped: result.skipped,
        updated: (result as ImportResult & { updated: number }).updated,
        errorCount: result.errors.length,
      },
      req,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Insurance import error:', err);
    res.status(500).json({ success: false, error: 'Import failed. All changes have been rolled back.' });
  }
});

// ── Import authorizations ──
router.post('/authorizations', requirePermission(Permission.DATA_IMPORT), async (req: Request, res: Response) => {
  try {
    const { csv, duplicateHandling = 'skip' } = req.body;
    const clinicId = req.auth!.clinicId;

    if (!csv || typeof csv !== 'string') {
      res.status(400).json({ success: false, error: 'CSV data is required' });
      return;
    }

    const rows = parseCSV(csv);
    if (rows.length === 0) {
      res.status(400).json({ success: false, error: 'No data rows found' });
      return;
    }

    const result = await transaction<ImportResult>(async (client) => {
      let imported = 0;
      let skipped = 0;
      let updated = 0;
      const errors: Array<{ row: number; reason: string }> = [];
      const matcher = await buildPatientMatcher(client, clinicId);

      for (let i = 0; i < rows.length; i++) {
        const mapped = mapRow(rows[i], AUTHORIZATION_FIELD_MAP);

        const dob = mapped.date_of_birth ? normalizeDate(mapped.date_of_birth) : null;
        const patientId = matchPatient(mapped, matcher, dob);
        if (!patientId) {
          errors.push({ row: i + 2, reason: `Patient not found: "${mapped.mrn || (mapped.patient_first_name + ' ' + mapped.patient_last_name)}". Import patients first.` });
          continue;
        }

        const authorizedVisits = parseInt(mapped.authorized_visits || '', 10);
        if (isNaN(authorizedVisits) || authorizedVisits < 0) {
          errors.push({ row: i + 2, reason: `Invalid visits authorized: "${mapped.authorized_visits}"` });
          continue;
        }
        const startDate = normalizeDate(mapped.start_date || '');
        if (!startDate) {
          errors.push({ row: i + 2, reason: `Invalid start date: "${mapped.start_date}"` });
          continue;
        }
        const endDate = mapped.end_date ? normalizeDate(mapped.end_date) : null;
        if (mapped.end_date && !endDate) {
          errors.push({ row: i + 2, reason: `Invalid end date: "${mapped.end_date}"` });
          continue;
        }
        const usedVisits = parseInt(mapped.used_visits || '0', 10);
        if (isNaN(usedVisits) || usedVisits < 0) {
          errors.push({ row: i + 2, reason: `Invalid visits used: "${mapped.used_visits}"` });
          continue;
        }

        // Link to insurance record by payer name when provided
        let insuranceId: string | null = null;
        if (mapped.payer_name) {
          const ins = await client.query(
            `SELECT id FROM insurance WHERE clinic_id = $1 AND patient_id = $2
             AND LOWER(payer_name) = LOWER($3) AND is_active = true
             ORDER BY is_primary DESC LIMIT 1`,
            [clinicId, patientId, mapped.payer_name]
          );
          if (ins.rows.length > 0) insuranceId = ins.rows[0].id;
        }

        const status = normalizeAuthStatus(mapped.status || '');
        const authNumber = mapped.authorization_number || null;

        // Duplicate check: same patient + auth number (when present), else same patient + payer + dates
        let existing: { rows: Array<{ id: string }> };
        if (authNumber) {
          existing = await client.query(
            `SELECT id FROM authorizations WHERE clinic_id = $1 AND patient_id = $2 AND authorization_number = $3`,
            [clinicId, patientId, authNumber]
          );
        } else {
          existing = await client.query(
            `SELECT id FROM authorizations WHERE clinic_id = $1 AND patient_id = $2
             AND start_date = $3 AND authorized_visits = $4 AND authorization_number IS NULL`,
            [clinicId, patientId, startDate, authorizedVisits]
          );
        }

        if (existing.rows.length > 0) {
          if (duplicateHandling === 'skip') {
            skipped++;
            continue;
          }
          await client.query(
            `UPDATE authorizations SET authorized_visits = $1, used_visits = $2,
              end_date = COALESCE($3, end_date), status = $4, notes = COALESCE($5, notes),
              insurance_id = COALESCE($6, insurance_id), updated_at = NOW()
             WHERE id = $7`,
            [authorizedVisits, usedVisits, endDate, status, mapped.notes || null, insuranceId, existing.rows[0].id]
          );
          updated++;
          continue;
        }

        await client.query(
          `INSERT INTO authorizations (clinic_id, patient_id, insurance_id, authorization_number,
            authorized_visits, used_visits, start_date, end_date, status, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            clinicId, patientId, insuranceId, authNumber,
            authorizedVisits, usedVisits, startDate, endDate, status,
            mapped.notes || null, req.auth!.userId,
          ]
        );
        imported++;
      }

      return { imported, skipped, errors, updated };
    });

    await logAudit({
      clinicId,
      userId: req.auth!.userId,
      action: AuditAction.DATA_IMPORT,
      resourceType: 'authorizations',
      details: {
        source: 'practice_perfect',
        totalRows: rows.length,
        imported: (result as ImportResult & { updated: number }).imported,
        skipped: result.skipped,
        updated: (result as ImportResult & { updated: number }).updated,
        errorCount: result.errors.length,
      },
      req,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Authorization import error:', err);
    res.status(500).json({ success: false, error: 'Import failed. All changes have been rolled back.' });
  }
});

// ── Download CSV templates ──
router.get('/template/patients', requirePermission(Permission.DATA_IMPORT), (_req: Request, res: Response) => {
  const headers = [
    'First Name', 'Last Name', 'Date of Birth', 'Gender', 'Phone', 'Email',
    'Address', 'City', 'State', 'Zip', 'Emergency Contact', 'Emergency Phone',
    'Primary Diagnosis', 'Referring Provider', 'Referral Source',
    'Insurance', 'Member ID', 'Group Number', 'MRN', 'Status',
  ];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="emr_os_patient_import_template.csv"');
  res.send(headers.join(',') + '\n');
});

router.get('/template/appointments', requirePermission(Permission.DATA_IMPORT), (_req: Request, res: Response) => {
  const headers = [
    'Appointment Date', 'Start Time', 'End Time', 'Duration',
    'Patient First Name', 'Patient Last Name', 'MRN',
    'Therapist', 'Appointment Type', 'Status', 'Notes',
  ];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="emr_os_appointment_import_template.csv"');
  res.send(headers.join(',') + '\n');
});

router.get('/template/insurance', requirePermission(Permission.DATA_IMPORT), (_req: Request, res: Response) => {
  const headers = [
    'MRN', 'Patient First Name', 'Patient Last Name', 'Date of Birth',
    'Payer', 'Plan Name', 'Member ID', 'Group Number',
    'Subscriber Name', 'Subscriber DOB', 'Subscriber Relationship',
    'Coverage Start', 'Coverage End', 'Insurance Type',
  ];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="emr_os_insurance_import_template.csv"');
  res.send(headers.join(',') + '\n');
});

router.get('/template/authorizations', requirePermission(Permission.DATA_IMPORT), (_req: Request, res: Response) => {
  const headers = [
    'MRN', 'Patient First Name', 'Patient Last Name', 'Date of Birth',
    'Payer', 'Auth Number', 'Visits Authorized', 'Visits Used',
    'Start Date', 'End Date', 'Status', 'Notes',
  ];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="emr_os_authorization_import_template.csv"');
  res.send(headers.join(',') + '\n');
});

export default router;
