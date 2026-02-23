import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query, transaction } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Enum Values ──

const BODY_REGIONS = [
  'cervical', 'thoracic', 'lumbar', 'shoulder', 'elbow', 'wrist_hand',
  'hip', 'knee', 'ankle_foot', 'core', 'upper_extremity', 'lower_extremity',
  'balance', 'full_body',
] as const;

const CATEGORIES = [
  'strengthening', 'stretching', 'rom', 'balance', 'functional',
  'cardio', 'manual_therapy', 'modality',
] as const;

const DIFFICULTIES = ['easy', 'moderate', 'hard'] as const;

// ── Zod Schemas ──

const exerciseSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  instructions: z.string().optional().nullable(),
  bodyRegion: z.enum(BODY_REGIONS),
  category: z.enum(CATEGORIES),
  difficulty: z.enum(DIFFICULTIES).optional().nullable(),
  defaultSets: z.number().int().positive().optional().nullable(),
  defaultReps: z.number().int().positive().optional().nullable(),
  defaultHoldSeconds: z.number().int().positive().optional().nullable(),
  defaultDurationMinutes: z.number().int().positive().optional().nullable(),
  videoUrl: z.string().url().optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  tags: z.array(z.string()).optional(),
});

const programSchema = z.object({
  name: z.string().min(1).max(255),
  patientId: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  isTemplate: z.boolean().optional().default(false),
  frequency: z.string().max(100).optional().nullable(),
  durationWeeks: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    exerciseId: z.string().uuid(),
    sortOrder: z.number().int().min(0),
    sets: z.number().int().positive().optional().nullable(),
    reps: z.number().int().positive().optional().nullable(),
    holdSeconds: z.number().int().positive().optional().nullable(),
    durationMinutes: z.number().int().positive().optional().nullable(),
    resistance: z.string().max(100).optional().nullable(),
    notes: z.string().optional().nullable(),
  })).optional(),
});

const programItemSchema = z.object({
  exerciseId: z.string().uuid(),
  sortOrder: z.number().int().min(0),
  sets: z.number().int().positive().optional().nullable(),
  reps: z.number().int().positive().optional().nullable(),
  holdSeconds: z.number().int().positive().optional().nullable(),
  durationMinutes: z.number().int().positive().optional().nullable(),
  resistance: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const adherenceSchema = z.object({
  completedAt: z.string().datetime().optional(),
  completionPercent: z.number().int().min(0).max(100),
  painLevel: z.number().int().min(0).max(10).optional().nullable(),
  difficultyRating: z.enum(DIFFICULTIES).optional().nullable(),
  notes: z.string().optional().nullable(),
  exercisesCompleted: z.array(z.string().uuid()).optional(),
});

// ══════════════════════════════════════════════════════════════
//  PROGRAMS
//  (registered before /:id routes to prevent Express matching
//   "programs" as an :id parameter)
// ══════════════════════════════════════════════════════════════

// List programs, filter by patient_id, is_template
router.get('/programs', requirePermission(Permission.HEP_VIEW), async (req: Request, res: Response) => {
  try {
    const { patient_id, is_template, page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'hp.clinic_id = $1';
    const params: unknown[] = [req.auth!.clinicId];

    if (patient_id) {
      whereClause += ` AND hp.patient_id = $${params.length + 1}`;
      params.push(patient_id);
    }

    if (is_template !== undefined) {
      whereClause += ` AND hp.is_template = $${params.length + 1}`;
      params.push(is_template === 'true');
    }

    const countResult = await query(
      `SELECT COUNT(*) as total FROM hep_programs hp WHERE ${whereClause}`,
      params
    );

    const result = await query(
      `SELECT hp.id, hp.name, hp.description, hp.patient_id, hp.is_template,
              hp.frequency, hp.duration_weeks, hp.status, hp.sent_at, hp.created_at,
              p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
              u.first_name as created_by_first_name, u.last_name as created_by_last_name
       FROM hep_programs hp
       LEFT JOIN patients p ON hp.patient_id = p.id
       LEFT JOIN users u ON hp.created_by = u.id
       WHERE ${whereClause}
       ORDER BY hp.created_at DESC
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

// Get program with items and exercise details
router.get('/programs/:id', requirePermission(Permission.HEP_VIEW), async (req: Request, res: Response) => {
  try {
    const programResult = await query(
      `SELECT hp.*,
              p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
              u.first_name as created_by_first_name, u.last_name as created_by_last_name
       FROM hep_programs hp
       LEFT JOIN patients p ON hp.patient_id = p.id
       LEFT JOIN users u ON hp.created_by = u.id
       WHERE hp.id = $1 AND hp.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (programResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

    const itemsResult = await query(
      `SELECT hpi.id, hpi.exercise_id, hpi.sort_order, hpi.sets, hpi.reps,
              hpi.hold_seconds, hpi.duration_minutes, hpi.resistance, hpi.notes,
              he.name as exercise_name, he.description as exercise_description,
              he.instructions as exercise_instructions, he.body_region,
              he.category, he.difficulty, he.video_url, he.image_url
       FROM hep_program_items hpi
       JOIN hep_exercises he ON hpi.exercise_id = he.id
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

// Create program with items (use transaction)
router.post('/programs', requirePermission(Permission.HEP_CREATE), async (req: Request, res: Response) => {
  try {
    const input = programSchema.parse(req.body);

    // If not a template, patient_id is required
    if (!input.isTemplate && !input.patientId) {
      res.status(400).json({ success: false, error: 'patientId is required for non-template programs' });
      return;
    }

    const result = await transaction(async (client) => {
      const programResult = await client.query(
        `INSERT INTO hep_programs (
          clinic_id, name, description, patient_id, is_template,
          frequency, duration_weeks, notes, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id`,
        [
          req.auth!.clinicId, input.name, input.description || null,
          input.patientId || null, input.isTemplate,
          input.frequency || null, input.durationWeeks || null,
          input.notes || null, req.auth!.userId,
        ]
      );

      const programId = programResult.rows[0].id;

      if (input.items && input.items.length > 0) {
        for (const item of input.items) {
          await client.query(
            `INSERT INTO hep_program_items (
              program_id, exercise_id, sort_order, sets, reps,
              hold_seconds, duration_minutes, resistance, notes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              programId, item.exerciseId, item.sortOrder,
              item.sets || null, item.reps || null,
              item.holdSeconds || null, item.durationMinutes || null,
              item.resistance || null, item.notes || null,
            ]
          );
        }
      }

      return { id: programId };
    });

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.HEP_PROGRAM_CREATE,
      resourceType: 'hep_program',
      resourceId: result.id,
      details: {
        name: input.name,
        isTemplate: input.isTemplate,
        itemCount: input.items?.length || 0,
      },
      req,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Update program
router.put('/programs/:id', requirePermission(Permission.HEP_EDIT), async (req: Request, res: Response) => {
  try {
    const input = programSchema.partial().parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      patientId: 'patient_id',
      isTemplate: 'is_template',
      frequency: 'frequency',
      durationWeeks: 'duration_weeks',
      notes: 'notes',
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
      `UPDATE hep_programs SET ${fields.join(', ')} WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.HEP_PROGRAM_EDIT,
      resourceType: 'hep_program',
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

// Add item to program
router.post('/programs/:id/items', requirePermission(Permission.HEP_EDIT), async (req: Request, res: Response) => {
  try {
    const input = programItemSchema.parse(req.body);

    // Verify program exists and belongs to this clinic
    const programCheck = await query(
      `SELECT id FROM hep_programs WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (programCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

    // Verify exercise exists and belongs to this clinic
    const exerciseCheck = await query(
      `SELECT id FROM hep_exercises WHERE id = $1 AND clinic_id = $2 AND is_active = true`,
      [input.exerciseId, req.auth!.clinicId]
    );
    if (exerciseCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Exercise not found' });
      return;
    }

    const result = await query(
      `INSERT INTO hep_program_items (
        program_id, exercise_id, sort_order, sets, reps,
        hold_seconds, duration_minutes, resistance, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id`,
      [
        req.params.id, input.exerciseId, input.sortOrder,
        input.sets || null, input.reps || null,
        input.holdSeconds || null, input.durationMinutes || null,
        input.resistance || null, input.notes || null,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.HEP_PROGRAM_EDIT,
      resourceType: 'hep_program',
      resourceId: req.params.id,
      details: { action: 'add_item', itemId: result.rows[0].id, exerciseId: input.exerciseId },
      req,
    });

    res.status(201).json({ success: true, data: { id: result.rows[0].id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Remove item from program
router.delete('/programs/:id/items/:itemId', requirePermission(Permission.HEP_EDIT), async (req: Request, res: Response) => {
  try {
    // Verify program exists and belongs to this clinic
    const programCheck = await query(
      `SELECT id FROM hep_programs WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (programCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

    const result = await query(
      `DELETE FROM hep_program_items WHERE id = $1 AND program_id = $2 RETURNING id`,
      [req.params.itemId, req.params.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Program item not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.HEP_PROGRAM_EDIT,
      resourceType: 'hep_program',
      resourceId: req.params.id,
      details: { action: 'remove_item', itemId: req.params.itemId },
      req,
    });

    res.json({ success: true, data: { id: req.params.itemId } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Assign template to patient (copy template into a patient-specific program)
router.post('/programs/:id/assign', requirePermission(Permission.HEP_CREATE), async (req: Request, res: Response) => {
  try {
    const { patientId } = z.object({ patientId: z.string().uuid() }).parse(req.body);

    // Verify the source program is a template and belongs to this clinic
    const templateResult = await query(
      `SELECT * FROM hep_programs WHERE id = $1 AND clinic_id = $2 AND is_template = true`,
      [req.params.id, req.auth!.clinicId]
    );
    if (templateResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    // Verify patient exists and belongs to this clinic
    const patientCheck = await query(
      `SELECT id FROM patients WHERE id = $1 AND clinic_id = $2`,
      [patientId, req.auth!.clinicId]
    );
    if (patientCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Patient not found' });
      return;
    }

    const template = templateResult.rows[0];

    const result = await transaction(async (client) => {
      // Create new program from template
      const newProgram = await client.query(
        `INSERT INTO hep_programs (
          clinic_id, name, description, patient_id, is_template,
          frequency, duration_weeks, notes, created_by, source_template_id
        ) VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8,$9)
        RETURNING id`,
        [
          req.auth!.clinicId, template.name, template.description,
          patientId, template.frequency, template.duration_weeks,
          template.notes, req.auth!.userId, req.params.id,
        ]
      );

      const newProgramId = newProgram.rows[0].id;

      // Copy all items from template
      const templateItems = await client.query(
        `SELECT exercise_id, sort_order, sets, reps, hold_seconds,
                duration_minutes, resistance, notes
         FROM hep_program_items
         WHERE program_id = $1
         ORDER BY sort_order`,
        [req.params.id]
      );

      for (const item of templateItems.rows) {
        await client.query(
          `INSERT INTO hep_program_items (
            program_id, exercise_id, sort_order, sets, reps,
            hold_seconds, duration_minutes, resistance, notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            newProgramId, item.exercise_id, item.sort_order,
            item.sets, item.reps, item.hold_seconds,
            item.duration_minutes, item.resistance, item.notes,
          ]
        );
      }

      return { id: newProgramId, itemsCopied: templateItems.rows.length };
    });

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.HEP_PROGRAM_ASSIGN,
      resourceType: 'hep_program',
      resourceId: result.id,
      details: {
        templateId: req.params.id,
        patientId,
        itemsCopied: result.itemsCopied,
      },
      req,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Send HEP to patient (mark as sent, returns PDF-ready data)
router.post('/programs/:id/send', requirePermission(Permission.HEP_EDIT), async (req: Request, res: Response) => {
  try {
    // Verify program exists, belongs to clinic, and is assigned to a patient
    const programResult = await query(
      `SELECT hp.*,
              p.first_name as patient_first_name, p.last_name as patient_last_name,
              p.mrn, p.email as patient_email
       FROM hep_programs hp
       JOIN patients p ON hp.patient_id = p.id
       WHERE hp.id = $1 AND hp.clinic_id = $2 AND hp.patient_id IS NOT NULL`,
      [req.params.id, req.auth!.clinicId]
    );

    if (programResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Program not found or not assigned to a patient' });
      return;
    }

    // Get items with full exercise details for PDF rendering
    const itemsResult = await query(
      `SELECT hpi.sort_order, hpi.sets, hpi.reps, hpi.hold_seconds,
              hpi.duration_minutes, hpi.resistance, hpi.notes as item_notes,
              he.name as exercise_name, he.description as exercise_description,
              he.instructions, he.body_region, he.category, he.difficulty,
              he.video_url, he.image_url
       FROM hep_program_items hpi
       JOIN hep_exercises he ON hpi.exercise_id = he.id
       WHERE hpi.program_id = $1
       ORDER BY hpi.sort_order`,
      [req.params.id]
    );

    // Mark program as sent
    await query(
      `UPDATE hep_programs SET status = 'sent', sent_at = NOW() WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    // Get clinic info for the PDF header
    const clinicResult = await query(
      `SELECT name, phone, fax, address_line1, city, state, zip FROM clinics WHERE id = $1`,
      [req.auth!.clinicId]
    );

    const program = programResult.rows[0];
    const pdfData = {
      program: {
        id: program.id,
        name: program.name,
        description: program.description,
        frequency: program.frequency,
        durationWeeks: program.duration_weeks,
        notes: program.notes,
        sentAt: new Date().toISOString(),
      },
      patient: {
        firstName: program.patient_first_name,
        lastName: program.patient_last_name,
        mrn: program.mrn,
        email: program.patient_email,
      },
      clinic: clinicResult.rows[0] || null,
      exercises: itemsResult.rows,
    };

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.HEP_PROGRAM_EDIT,
      resourceType: 'hep_program',
      resourceId: req.params.id,
      details: { action: 'send', patientId: program.patient_id },
      req,
    });

    res.json({ success: true, data: pdfData });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Adherence ──

// Log adherence entry
router.post('/programs/:id/adherence', requirePermission(Permission.HEP_EDIT), async (req: Request, res: Response) => {
  try {
    const input = adherenceSchema.parse(req.body);

    // Verify program exists and belongs to this clinic
    const programCheck = await query(
      `SELECT id, patient_id FROM hep_programs WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (programCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

    const result = await query(
      `INSERT INTO hep_adherence_logs (
        program_id, patient_id, completed_at, completion_percent,
        pain_level, difficulty_rating, notes, exercises_completed, logged_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id`,
      [
        req.params.id,
        programCheck.rows[0].patient_id,
        input.completedAt || new Date().toISOString(),
        input.completionPercent,
        input.painLevel ?? null,
        input.difficultyRating || null,
        input.notes || null,
        input.exercisesCompleted || [],
        req.auth!.userId,
      ]
    );

    res.status(201).json({ success: true, data: { id: result.rows[0].id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get adherence history
router.get('/programs/:id/adherence', requirePermission(Permission.HEP_VIEW), async (req: Request, res: Response) => {
  try {
    const { page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    // Verify program exists and belongs to this clinic
    const programCheck = await query(
      `SELECT id FROM hep_programs WHERE id = $1 AND clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );
    if (programCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

    const countResult = await query(
      `SELECT COUNT(*) as total FROM hep_adherence_logs WHERE program_id = $1`,
      [req.params.id]
    );

    const result = await query(
      `SELECT hal.id, hal.completed_at, hal.completion_percent, hal.pain_level,
              hal.difficulty_rating, hal.notes, hal.exercises_completed, hal.created_at,
              u.first_name as logged_by_first_name, u.last_name as logged_by_last_name
       FROM hep_adherence_logs hal
       LEFT JOIN users u ON hal.logged_by = u.id
       WHERE hal.program_id = $1
       ORDER BY hal.completed_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limitNum, offset]
    );

    // Calculate summary stats
    const statsResult = await query(
      `SELECT
         COUNT(*) as total_entries,
         ROUND(AVG(completion_percent), 1) as avg_completion,
         ROUND(AVG(pain_level), 1) as avg_pain_level,
         MAX(completed_at) as last_completed_at
       FROM hep_adherence_logs
       WHERE program_id = $1`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        entries: result.rows,
        summary: statsResult.rows[0],
      },
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

// ══════════════════════════════════════════════════════════════
//  EXERCISES (library)
//  (/:id routes registered after /programs/* to avoid conflicts)
// ══════════════════════════════════════════════════════════════

// List exercises with search, filter by body_region/category, pagination
router.get('/', requirePermission(Permission.HEP_VIEW), async (req: Request, res: Response) => {
  try {
    const { search, body_region, category, page = '1', limit = '25' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'clinic_id = $1 AND is_active = true';
    const params: unknown[] = [req.auth!.clinicId];

    if (search) {
      whereClause += ` AND (
        LOWER(name) LIKE LOWER($${params.length + 1}) OR
        LOWER(description) LIKE LOWER($${params.length + 1}) OR
        LOWER(instructions) LIKE LOWER($${params.length + 1})
      )`;
      params.push(`%${search}%`);
    }

    if (body_region) {
      whereClause += ` AND body_region = $${params.length + 1}`;
      params.push(body_region);
    }

    if (category) {
      whereClause += ` AND category = $${params.length + 1}`;
      params.push(category);
    }

    const countResult = await query(
      `SELECT COUNT(*) as total FROM hep_exercises WHERE ${whereClause}`,
      params
    );

    const result = await query(
      `SELECT id, name, description, body_region, category, difficulty,
              default_sets, default_reps, default_hold_seconds, default_duration_minutes,
              video_url, image_url, tags, created_at
       FROM hep_exercises
       WHERE ${whereClause}
       ORDER BY name
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

// Create exercise
router.post('/', requirePermission(Permission.HEP_CREATE), async (req: Request, res: Response) => {
  try {
    const input = exerciseSchema.parse(req.body);

    const result = await query(
      `INSERT INTO hep_exercises (
        clinic_id, name, description, instructions, body_region, category, difficulty,
        default_sets, default_reps, default_hold_seconds, default_duration_minutes,
        video_url, image_url, tags, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id`,
      [
        req.auth!.clinicId, input.name, input.description || null,
        input.instructions || null, input.bodyRegion, input.category,
        input.difficulty || null,
        input.defaultSets || null, input.defaultReps || null,
        input.defaultHoldSeconds || null, input.defaultDurationMinutes || null,
        input.videoUrl || null, input.imageUrl || null,
        input.tags || [], req.auth!.userId,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.HEP_EXERCISE_CREATE,
      resourceType: 'hep_exercise',
      resourceId: result.rows[0].id,
      details: { name: input.name, bodyRegion: input.bodyRegion, category: input.category },
      req,
    });

    res.status(201).json({ success: true, data: { id: result.rows[0].id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get single exercise
router.get('/:id', requirePermission(Permission.HEP_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM hep_exercises WHERE id = $1 AND clinic_id = $2 AND is_active = true`,
      [req.params.id, req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Exercise not found' });
      return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Update exercise
router.put('/:id', requirePermission(Permission.HEP_EDIT), async (req: Request, res: Response) => {
  try {
    const input = exerciseSchema.partial().parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      instructions: 'instructions',
      bodyRegion: 'body_region',
      category: 'category',
      difficulty: 'difficulty',
      defaultSets: 'default_sets',
      defaultReps: 'default_reps',
      defaultHoldSeconds: 'default_hold_seconds',
      defaultDurationMinutes: 'default_duration_minutes',
      videoUrl: 'video_url',
      imageUrl: 'image_url',
      tags: 'tags',
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
      `UPDATE hep_exercises SET ${fields.join(', ')} WHERE id = $1 AND clinic_id = $2 AND is_active = true RETURNING id`,
      [req.params.id, req.auth!.clinicId, ...values]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Exercise not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.HEP_EXERCISE_EDIT,
      resourceType: 'hep_exercise',
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

// Soft delete exercise (set is_active=false)
router.delete('/:id', requirePermission(Permission.HEP_DELETE), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE hep_exercises SET is_active = false WHERE id = $1 AND clinic_id = $2 AND is_active = true RETURNING id`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Exercise not found' });
      return;
    }

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.HEP_EXERCISE_EDIT,
      resourceType: 'hep_exercise',
      resourceId: req.params.id,
      details: { action: 'soft_delete' },
      req,
    });

    res.json({ success: true, data: { id: req.params.id } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
