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
    if (type !== 'patients') {
      res.status(400).json({ success: false, error: 'Only "patients" import type is supported' });
      return;
    }

    const rows = parseCSV(csv);
    if (rows.length === 0) {
      res.status(400).json({ success: false, error: 'No data rows found in CSV' });
      return;
    }

    const headers = Object.keys(rows[0]);
    const mappedFields = headers.filter(h => PATIENT_FIELD_MAP[h]).map(h => ({
      csvField: h,
      mapsTo: PATIENT_FIELD_MAP[h],
    }));
    const unmappedFields = headers.filter(h => !PATIENT_FIELD_MAP[h]);

    // Preview first 5 rows mapped
    const preview = rows.slice(0, 5).map(row => mapRow(row, PATIENT_FIELD_MAP));

    // Validate all rows
    const errors: Array<{ row: number; reason: string }> = [];
    let validCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const mapped = mapRow(rows[i], PATIENT_FIELD_MAP);
      if (!mapped.first_name || !mapped.last_name) {
        errors.push({ row: i + 2, reason: 'Missing first or last name' });
      } else if (mapped.date_of_birth && !normalizeDate(mapped.date_of_birth)) {
        errors.push({ row: i + 2, reason: `Invalid date format: "${mapped.date_of_birth}"` });
      } else {
        validCount++;
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
        errors: errors.slice(0, 20), // cap error preview
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

// ── Download CSV template ──
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

export default router;
