import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction, NoteStatus } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Copy Forward ──
// Copy content from a previous note into a target draft note.
router.post('/copy-forward', requirePermission(Permission.NOTE_EDIT), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      sourceNoteId: z.string().uuid(),
      targetNoteId: z.string().uuid(),
    });
    const input = schema.parse(req.body);

    // Fetch the source note
    const sourceResult = await query(
      `SELECT subjective, objective, assessment, plan, eval_data, cpt_codes, icd10_codes
       FROM clinical_notes
       WHERE id = $1 AND clinic_id = $2`,
      [input.sourceNoteId, req.auth!.clinicId]
    );
    if (sourceResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Source note not found' });
      return;
    }

    // Verify the target note exists and is in draft status
    const targetResult = await query(
      `SELECT id, status FROM clinical_notes WHERE id = $1 AND clinic_id = $2`,
      [input.targetNoteId, req.auth!.clinicId]
    );
    if (targetResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Target note not found' });
      return;
    }
    if (targetResult.rows[0].status !== NoteStatus.DRAFT) {
      res.status(400).json({ success: false, error: 'Target note must be in draft status to copy forward' });
      return;
    }

    const source = sourceResult.rows[0];

    // Copy fields from source to target
    await query(
      `UPDATE clinical_notes SET
        subjective = $3,
        objective = $4,
        assessment = $5,
        plan = $6,
        eval_data = $7,
        cpt_codes = $8,
        icd10_codes = $9
       WHERE id = $1 AND clinic_id = $2`,
      [
        input.targetNoteId, req.auth!.clinicId,
        source.subjective, source.objective, source.assessment, source.plan,
        source.eval_data ? JSON.stringify(source.eval_data) : null,
        source.cpt_codes, source.icd10_codes,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.NOTE_EDIT,
      resourceType: 'clinical_note',
      resourceId: input.targetNoteId,
      details: { action: 'copy_forward', sourceNoteId: input.sourceNoteId },
      req,
    });

    res.json({ success: true, data: { targetNoteId: input.targetNoteId, sourceNoteId: input.sourceNoteId } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Save Body Chart ──
// Save body chart markers into the note's eval_data.body_chart field.
router.post('/body-chart', requirePermission(Permission.NOTE_EDIT), async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      noteId: z.string().uuid(),
      markers: z.array(z.object({
        id: z.string(),
        x: z.number(),
        y: z.number(),
        region: z.string(),
        painType: z.enum(['sharp', 'dull', 'burning', 'aching', 'tingling', 'numbness']),
        intensity: z.number().min(0).max(10),
        notes: z.string(),
      })),
    });
    const input = schema.parse(req.body);

    // Verify the note exists and belongs to this clinic
    const noteResult = await query(
      `SELECT id, status, eval_data FROM clinical_notes WHERE id = $1 AND clinic_id = $2`,
      [input.noteId, req.auth!.clinicId]
    );
    if (noteResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    if (noteResult.rows[0].status !== NoteStatus.DRAFT) {
      res.status(400).json({ success: false, error: 'Body chart can only be updated on draft notes' });
      return;
    }

    // Merge body_chart into existing eval_data (preserve other eval_data fields)
    const existingEvalData = noteResult.rows[0].eval_data || {};
    const updatedEvalData = {
      ...existingEvalData,
      body_chart: input.markers,
    };

    await query(
      `UPDATE clinical_notes SET eval_data = $3 WHERE id = $1 AND clinic_id = $2`,
      [input.noteId, req.auth!.clinicId, JSON.stringify(updatedEvalData)]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.NOTE_EDIT,
      resourceType: 'clinical_note',
      resourceId: input.noteId,
      details: { action: 'body_chart_save', markerCount: input.markers.length },
      req,
    });

    res.json({ success: true, data: { noteId: input.noteId, markerCount: input.markers.length } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Get Body Chart ──
// Retrieve body chart data from a note's eval_data.body_chart field.
router.get('/body-chart/:noteId', requirePermission(Permission.NOTE_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT eval_data FROM clinical_notes WHERE id = $1 AND clinic_id = $2`,
      [req.params.noteId, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }

    const evalData = result.rows[0].eval_data || {};
    const bodyChart = evalData.body_chart || [];

    res.json({ success: true, data: { noteId: req.params.noteId, markers: bodyChart } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
