import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { authenticatePortalUser, requireActivePortalUser } from './portal';

/**
 * Patient-facing HEP endpoints.
 *
 * Mounted at /api/portal/patient/hep. Authenticated via the portal JWT
 * (authenticatePortalUser), NOT staff requirePermission. Every query is
 * scoped to req.portal.patientId / req.portal.clinicId — the patient can
 * only ever see or log their own programs.
 */
const router = Router();
router.use(authenticatePortalUser, requireActivePortalUser);

// ── GET /my-programs — patient's active (non-template) HEP programs ─────────
router.get('/my-programs', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    const result = await query(
      `SELECT hp.id, hp.name, hp.description, hp.status, hp.frequency, hp.phase,
              hp.start_date, hp.end_date, hp.created_at,
              COUNT(hpi.id)::int AS item_count
       FROM exercise_programs hp
       LEFT JOIN exercise_program_items hpi ON hpi.program_id = hp.id
       WHERE hp.patient_id = $1 AND hp.clinic_id = $2
         AND hp.is_active = true AND hp.is_template = false
         AND hp.status = 'active'
       GROUP BY hp.id
       ORDER BY hp.created_at DESC`,
      [patientId, clinicId]
    );
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /my-programs/:id — full program detail with exercise detail ──────────
router.get('/my-programs/:id', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    const programResult = await query(
      `SELECT hp.id, hp.name, hp.description, hp.status, hp.frequency, hp.phase,
              hp.start_date, hp.end_date
       FROM exercise_programs hp
       WHERE hp.id = $1 AND hp.patient_id = $2 AND hp.clinic_id = $3
         AND hp.is_active = true AND hp.is_template = false`,
      [req.params.id, patientId, clinicId]
    );
    if (programResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

    const itemsResult = await query(
      `SELECT hpi.id, hpi.exercise_id, hpi.sort_order, hpi.sets, hpi.reps,
              hpi.hold_seconds, hpi.duration_minutes, hpi.resistance, hpi.notes,
              he.name AS exercise_name, he.description AS exercise_description,
              he.instructions AS exercise_instructions, he.body_region,
              he.category, he.difficulty, he.video_url, he.image_url
       FROM exercise_program_items hpi
       JOIN exercises he ON hpi.exercise_id = he.id
       WHERE hpi.program_id = $1
       ORDER BY hpi.sort_order`,
      [req.params.id]
    );

    const program = programResult.rows[0];
    program.items = itemsResult.rows;
    res.json({ success: true, data: program });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /my-programs/:id/checkoff — log a patient check-off session ─────────
const checkoffSchema = z.object({
  exerciseIds: z.array(z.string().uuid()).min(1).max(200),
  painLevel: z.number().int().min(0).max(10).optional().nullable(),
  difficulty: z.number().int().min(1).max(5).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

router.post('/my-programs/:id/checkoff', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    const input = checkoffSchema.parse(req.body);

    // Verify the program belongs to this patient
    const programResult = await query(
      `SELECT id FROM exercise_programs
       WHERE id = $1 AND patient_id = $2 AND clinic_id = $3
         AND is_active = true AND is_template = false`,
      [req.params.id, patientId, clinicId]
    );
    if (programResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

    // Validate the checked exercises are items of this program
    const itemsResult = await query(
      `SELECT id FROM exercise_program_items WHERE program_id = $1`,
      [req.params.id]
    );
    const validIds = new Set(itemsResult.rows.map((r: any) => r.id));
    const checkedIds = input.exerciseIds.filter((id) => validIds.has(id));
    if (checkedIds.length === 0) {
      res.status(400).json({ success: false, error: 'No valid exercises selected' });
      return;
    }

    const total = itemsResult.rows.length;
    const completionPercent = Math.round((checkedIds.length / total) * 100);

    const insertResult = await query(
      `INSERT INTO hep_adherence_logs
         (program_id, patient_id, completed_date, completed_at, completion_percent,
          pain_level, difficulty_rating, notes, exercises_completed, logged_by, logged_by_type)
       VALUES ($1, $2, CURRENT_DATE, NOW(), $3, $4, $5, $6, $7, NULL, 'patient')
       RETURNING id, completed_at`,
      [
        req.params.id,
        patientId,
        completionPercent,
        input.painLevel ?? null,
        input.difficulty != null ? String(input.difficulty) : null,
        input.notes?.trim() || null,
        checkedIds,
      ]
    );

    res.status(201).json({
      success: true,
      data: {
        id: insertResult.rows[0].id,
        completionPercent,
        exercisesCompleted: checkedIds.length,
        exercisesTotal: total,
        completedAt: insertResult.rows[0].completed_at,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input' });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /my-programs/:id/adherence — patient's own adherence history ─────────
router.get('/my-programs/:id/adherence', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    const programResult = await query(
      `SELECT id FROM exercise_programs
       WHERE id = $1 AND patient_id = $2 AND clinic_id = $3
         AND is_active = true AND is_template = false`,
      [req.params.id, patientId, clinicId]
    );
    if (programResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

    const result = await query(
      `SELECT id, completed_at, completion_percent, pain_level,
              difficulty_rating, notes, exercises_completed, logged_by_type
       FROM hep_adherence_logs
       WHERE program_id = $1 AND patient_id = $2
       ORDER BY completed_at DESC
       LIMIT 50`,
      [req.params.id, patientId]
    );
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
