import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

// Mounted at /api/patients/:id/notes — mergeParams gives us req.params.id (the patient).
const router = Router({ mergeParams: true });
router.use(authenticate, validateSession, tenantScope);

const noteCreateSchema = z.object({
  noteText: z.string().min(1).max(5000),
  category: z.enum(['scheduling', 'billing', 'clinical_alert', 'general']).default('general'),
  isPinned: z.boolean().default(false),
});

const noteUpdateSchema = z.object({
  noteText: z.string().min(1).max(5000).optional(),
  category: z.enum(['scheduling', 'billing', 'clinical_alert', 'general']).optional(),
  isPinned: z.boolean().optional(),
});

async function patientExists(patientId: string, clinicId: string): Promise<boolean> {
  const r = await query(`SELECT 1 FROM patients WHERE id = $1 AND clinic_id = $2`, [patientId, clinicId]);
  return r.rows.length > 0;
}

// ── GET /api/patients/:id/notes — active notes, pinned first ──
router.get('/', requirePermission(Permission.PATIENT_NOTE_VIEW), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const patientId = req.params.id;
    if (!(await patientExists(patientId, clinicId))) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }
    const result = await query(
      `SELECT n.*, u.first_name AS author_first, u.last_name AS author_last
       FROM patient_notes n
       JOIN users u ON n.author_id = u.id
       WHERE n.patient_id = $1 AND n.clinic_id = $2 AND n.is_active = true
       ORDER BY n.is_pinned DESC, n.created_at DESC`,
      [patientId, clinicId]
    );
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /api/patients/:id/notes — create ──
router.post('/', requirePermission(Permission.PATIENT_NOTE_CREATE), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;
    const patientId = req.params.id;
    if (!(await patientExists(patientId, clinicId))) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }
    const input = noteCreateSchema.parse(req.body);
    const result = await query(
      `INSERT INTO patient_notes (clinic_id, patient_id, author_id, note_text, category, is_pinned)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [clinicId, patientId, userId, input.noteText, input.category, input.isPinned]
    );
    await logAudit({
      clinicId,
      userId,
      action: AuditAction.PATIENT_NOTE_CREATE,
      resourceType: 'patient_note',
      resourceId: result.rows[0].id,
      details: { patientId, category: input.category, isPinned: input.isPinned },
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

// ── PUT /api/patients/:id/notes/:noteId — edit text/category/pin ──
router.put('/:noteId', requirePermission(Permission.PATIENT_NOTE_MANAGE), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;
    const patientId = req.params.id;
    const input = noteUpdateSchema.parse(req.body);

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 4;
    if (input.noteText !== undefined) { sets.push(`note_text = $${idx++}`); values.push(input.noteText); }
    if (input.category !== undefined) { sets.push(`category = $${idx++}`); values.push(input.category); }
    if (input.isPinned !== undefined) { sets.push(`is_pinned = $${idx++}`); values.push(input.isPinned); }
    if (sets.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }
    sets.push(`updated_at = NOW()`);

    const result = await query(
      `UPDATE patient_notes SET ${sets.join(', ')}
       WHERE id = $1 AND patient_id = $2 AND clinic_id = $3 AND is_active = true
       RETURNING *`,
      [req.params.noteId, patientId, clinicId, ...values]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    await logAudit({
      clinicId,
      userId,
      action: AuditAction.PATIENT_NOTE_EDIT,
      resourceType: 'patient_note',
      resourceId: req.params.noteId,
      details: { patientId, updatedFields: Object.keys(input) },
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

// ── POST /api/patients/:id/notes/:noteId/deactivate — soft delete ──
router.post('/:noteId/deactivate', requirePermission(Permission.PATIENT_NOTE_MANAGE), async (req: Request, res: Response) => {
  try {
    const clinicId = req.auth!.clinicId;
    const userId = req.auth!.userId;
    const patientId = req.params.id;
    const result = await query(
      `UPDATE patient_notes SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND patient_id = $2 AND clinic_id = $3 AND is_active = true
       RETURNING id`,
      [req.params.noteId, patientId, clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    await logAudit({
      clinicId,
      userId,
      action: AuditAction.PATIENT_NOTE_DEACTIVATE,
      resourceType: 'patient_note',
      resourceId: req.params.noteId,
      details: { patientId },
      req,
    });
    res.json({ success: true, data: { id: req.params.noteId } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
