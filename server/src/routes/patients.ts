import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';
import { v4 as uuid } from 'uuid';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

const patientSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.string().min(1),
  ssnLast4: z.string().length(4).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  addressLine1: z.string().max(255).optional().nullable(),
  addressLine2: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(2).optional().nullable(),
  zip: z.string().max(10).optional().nullable(),
  emergencyContactName: z.string().max(200).optional().nullable(),
  emergencyContactPhone: z.string().max(20).optional().nullable(),
  guarantorName: z.string().max(200).optional().nullable(),
  guarantorPhone: z.string().max(20).optional().nullable(),
  guarantorRelationship: z.string().max(50).optional().nullable(),
  referralSource: z.string().max(200).optional().nullable(),
  referringProvider: z.string().max(200).optional().nullable(),
  referringProviderNpi: z.string().max(10).optional().nullable(),
  primaryDiagnosisIcd10: z.string().max(10).optional().nullable(),
  secondaryDiagnosesIcd10: z.array(z.string()).optional(),
  precautions: z.string().optional().nullable(),
});

function generateMRN(): string {
  const now = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PT-${now}-${rand}`;
}

// List patients
router.get('/', requirePermission(Permission.PATIENT_VIEW), async (req: Request, res: Response) => {
  try {
    const { search, page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'clinic_id = $1';
    const params: unknown[] = [req.auth!.clinicId];

    if (search) {
      whereClause += ` AND (
        LOWER(first_name) LIKE LOWER($2) OR
        LOWER(last_name) LIKE LOWER($2) OR
        mrn LIKE $2
      )`;
      params.push(`%${search}%`);
    }

    const countResult = await query(
      `SELECT COUNT(*) as total FROM patients WHERE ${whereClause}`,
      params
    );

    const result = await query(
      `SELECT id, mrn, first_name, last_name, date_of_birth, gender, phone, email,
              primary_diagnosis_icd10, is_active, created_at
       FROM patients
       WHERE ${whereClause}
       ORDER BY last_name, first_name
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limitNum, offset]
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

// Get patient
router.get('/:id', requirePermission(Permission.PATIENT_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM patients WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.CHART_OPEN,
      resourceType: 'patient',
      resourceId: req.params.id,
      req,
    });
    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Create patient
router.post('/', requirePermission(Permission.PATIENT_CREATE), async (req: Request, res: Response) => {
  try {
    const input = patientSchema.parse(req.body);
    const mrn = generateMRN();
    const result = await query(
      `INSERT INTO patients (
        clinic_id, mrn, first_name, last_name, date_of_birth, gender,
        ssn_last4, email, phone, address_line1, address_line2,
        city, state, zip, emergency_contact_name, emergency_contact_phone,
        guarantor_name, guarantor_phone, guarantor_relationship,
        referral_source, referring_provider, referring_provider_npi,
        primary_diagnosis_icd10, secondary_diagnoses_icd10, precautions
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
      RETURNING id, mrn`,
      [
        req.auth!.clinicId, mrn, input.firstName, input.lastName,
        input.dateOfBirth, input.gender, input.ssnLast4 || null,
        input.email || null, input.phone || null,
        input.addressLine1 || null, input.addressLine2 || null,
        input.city || null, input.state || null, input.zip || null,
        input.emergencyContactName || null, input.emergencyContactPhone || null,
        input.guarantorName || null, input.guarantorPhone || null,
        input.guarantorRelationship || null,
        input.referralSource || null, input.referringProvider || null,
        input.referringProviderNpi || null,
        input.primaryDiagnosisIcd10 || null,
        input.secondaryDiagnosesIcd10 || [],
        input.precautions || null,
      ]
    );
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.PATIENT_CREATE,
      resourceType: 'patient',
      resourceId: result.rows[0].id,
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

// Update patient
router.put('/:id', requirePermission(Permission.PATIENT_EDIT), async (req: Request, res: Response) => {
  try {
    const input = patientSchema.partial().parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      firstName: 'first_name', lastName: 'last_name', dateOfBirth: 'date_of_birth',
      gender: 'gender', ssnLast4: 'ssn_last4', email: 'email', phone: 'phone',
      addressLine1: 'address_line1', addressLine2: 'address_line2',
      city: 'city', state: 'state', zip: 'zip',
      emergencyContactName: 'emergency_contact_name', emergencyContactPhone: 'emergency_contact_phone',
      guarantorName: 'guarantor_name', guarantorPhone: 'guarantor_phone',
      guarantorRelationship: 'guarantor_relationship',
      referralSource: 'referral_source', referringProvider: 'referring_provider',
      referringProviderNpi: 'referring_provider_npi',
      primaryDiagnosisIcd10: 'primary_diagnosis_icd10',
      secondaryDiagnosesIcd10: 'secondary_diagnoses_icd10',
      precautions: 'precautions',
    };

    for (const [key, value] of Object.entries(input)) {
      if (fieldMap[key]) {
        fields.push(`${fieldMap[key]} = $${idx++}`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    const result = await query(
      `UPDATE patients SET ${fields.join(', ')} WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.PATIENT_EDIT,
      resourceType: 'patient',
      resourceId: req.params.id,
      details: { updatedFields: Object.keys(input) },
      req,
    });

    res.json({ success: true, data: { id: req.params.id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
