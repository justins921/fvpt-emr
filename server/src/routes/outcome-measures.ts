import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { query } from '../db';
import { Permission, AuditAction } from '../types';
import { logAudit } from '../services/audit';

const router = Router();
router.use(authenticate, validateSession, tenantScope);

// ── Zod Schemas ──

const createMeasureSchema = z.object({
  patientId: z.string().uuid(),
  noteId: z.string().uuid().optional().nullable(),
  measureType: z.string().min(1).max(50),
  score: z.number().min(0),
  maxScore: z.number().min(0),
  percentage: z.number().min(0).max(100).optional().nullable(),
  responses: z.record(z.unknown()).optional().nullable(),
  administeredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  interpretation: z.string().max(500).optional().nullable(),
});

const calculateSchema = z.object({
  measureType: z.string().min(1),
  responses: z.record(z.unknown()),
});

// ── Outcome Measure Definitions ──

interface ScoringBracket {
  min: number;
  max: number;
  label: string;
}

interface OutcomeMeasureDefinition {
  name: string;
  key: string;
  maxScore: number;
  description: string;
  scoring: ScoringBracket[];
  categories: string[];
}

const OUTCOME_MEASURE_DEFINITIONS: OutcomeMeasureDefinition[] = [
  {
    name: 'Lower Extremity Functional Scale',
    key: 'LEFS',
    maxScore: 80,
    description: 'Self-report measure of lower extremity function. 20 items scored 0-4 each.',
    scoring: [
      { min: 0, max: 19, label: 'Severe functional limitation' },
      { min: 20, max: 39, label: 'Moderate functional limitation' },
      { min: 40, max: 59, label: 'Mild functional limitation' },
      { min: 60, max: 80, label: 'Minimal functional limitation' },
    ],
    categories: [
      'Usual work/housework/school activities',
      'Usual hobbies/recreational/sporting activities',
      'Getting into/out of bath',
      'Walking between rooms',
      'Putting on shoes/socks',
      'Squatting',
      'Lifting an object from the floor',
      'Performing light activities at home',
      'Performing heavy activities at home',
      'Getting into/out of car',
      'Walking 2 blocks',
      'Walking a mile',
      'Going up/down 10 stairs',
      'Standing for 1 hour',
      'Sitting for 1 hour',
      'Running on even ground',
      'Running on uneven ground',
      'Making sharp turns while running fast',
      'Hopping',
      'Rolling over in bed',
    ],
  },
  {
    name: 'Disabilities of the Arm, Shoulder and Hand',
    key: 'DASH',
    maxScore: 100,
    description: 'Measures upper extremity disability and symptoms. 30 items, scored as percentage of disability.',
    scoring: [
      { min: 0, max: 20, label: 'No/little disability' },
      { min: 21, max: 40, label: 'Mild disability' },
      { min: 41, max: 60, label: 'Moderate disability' },
      { min: 61, max: 80, label: 'Severe disability' },
      { min: 81, max: 100, label: 'Extreme disability' },
    ],
    categories: [
      'Open a tight or new jar',
      'Write',
      'Turn a key',
      'Prepare a meal',
      'Push open a heavy door',
      'Place an object on a shelf above your head',
      'Do heavy household chores',
      'Garden or do yard work',
      'Make a bed',
      'Carry a shopping bag or briefcase',
      'Carry a heavy object (over 10 lbs)',
      'Change a lightbulb overhead',
      'Wash or blow dry your hair',
      'Wash your back',
      'Put on a pullover sweater',
      'Use a knife to cut food',
      'Recreational activities (little effort)',
      'Recreational activities (force/impact through arm)',
      'Recreational activities (move arm freely)',
      'Manage transportation needs',
      'Sexual activities',
      'Arm/shoulder/hand problem interfere with social activities',
      'Arm/shoulder/hand problem limit work or daily activities',
      'Arm/shoulder/hand pain',
      'Arm/shoulder/hand pain during specific activity',
      'Tingling',
      'Weakness',
      'Stiffness',
      'Difficulty sleeping',
      'Feeling less capable/confident/useful',
    ],
  },
  {
    name: 'Neck Disability Index',
    key: 'NDI',
    maxScore: 50,
    description: 'Measures self-rated neck disability. 10 items scored 0-5 each.',
    scoring: [
      { min: 0, max: 4, label: 'No disability' },
      { min: 5, max: 14, label: 'Mild disability' },
      { min: 15, max: 24, label: 'Moderate disability' },
      { min: 25, max: 34, label: 'Severe disability' },
      { min: 35, max: 50, label: 'Complete disability' },
    ],
    categories: [
      'Pain intensity',
      'Personal care (washing, dressing)',
      'Lifting',
      'Reading',
      'Headaches',
      'Concentration',
      'Work',
      'Driving',
      'Sleeping',
      'Recreation',
    ],
  },
  {
    name: 'Oswestry Disability Index',
    key: 'Oswestry',
    maxScore: 50,
    description: 'Measures permanent functional disability for low back pain. 10 items scored 0-5 each.',
    scoring: [
      { min: 0, max: 4, label: 'No disability' },
      { min: 5, max: 14, label: 'Mild disability' },
      { min: 15, max: 24, label: 'Moderate disability' },
      { min: 25, max: 34, label: 'Severe disability' },
      { min: 35, max: 50, label: 'Crippling/bed-bound' },
    ],
    categories: [
      'Pain intensity',
      'Personal care',
      'Lifting',
      'Walking',
      'Sitting',
      'Standing',
      'Sleeping',
      'Sex life',
      'Social life',
      'Travelling',
    ],
  },
  {
    name: 'Shoulder Pain and Disability Index',
    key: 'SPADI',
    maxScore: 130,
    description: 'Measures shoulder pain and disability. 13 items: 5 pain items (0-10) and 8 disability items (0-10).',
    scoring: [
      { min: 0, max: 25, label: 'Minimal pain/disability' },
      { min: 26, max: 50, label: 'Mild pain/disability' },
      { min: 51, max: 75, label: 'Moderate pain/disability' },
      { min: 76, max: 100, label: 'Severe pain/disability' },
      { min: 101, max: 130, label: 'Very severe pain/disability' },
    ],
    categories: [
      'Pain: At its worst',
      'Pain: Lying on involved side',
      'Pain: Reaching for something on a high shelf',
      'Pain: Touching the back of your neck',
      'Pain: Pushing with the involved arm',
      'Disability: Washing your hair',
      'Disability: Washing your back',
      'Disability: Putting on an undershirt/pullover',
      'Disability: Putting on a shirt that buttons down the front',
      'Disability: Putting on your pants',
      'Disability: Placing an object on a high shelf',
      'Disability: Carrying a heavy object of 10 pounds',
      'Disability: Removing something from your back pocket',
    ],
  },
  {
    name: 'Berg Balance Scale',
    key: 'Berg Balance',
    maxScore: 56,
    description: 'Measures static and dynamic balance. 14 items scored 0-4 each.',
    scoring: [
      { min: 0, max: 20, label: 'High fall risk (wheelchair bound)' },
      { min: 21, max: 40, label: 'Medium fall risk (walking with assistance)' },
      { min: 41, max: 56, label: 'Low fall risk (independent)' },
    ],
    categories: [
      'Sitting to standing',
      'Standing unsupported',
      'Sitting unsupported',
      'Standing to sitting',
      'Transfers',
      'Standing with eyes closed',
      'Standing with feet together',
      'Reaching forward with outstretched arm',
      'Retrieving object from floor',
      'Turning to look behind',
      'Turning 360 degrees',
      'Placing alternate foot on stool',
      'Standing with one foot in front',
      'Standing on one foot',
    ],
  },
  {
    name: 'Numeric Pain Rating Scale',
    key: 'NPRS',
    maxScore: 10,
    description: 'Patient rates pain intensity on 0-10 scale. Simple, reliable, widely used.',
    scoring: [
      { min: 0, max: 0, label: 'No pain' },
      { min: 1, max: 3, label: 'Mild pain' },
      { min: 4, max: 6, label: 'Moderate pain' },
      { min: 7, max: 10, label: 'Severe pain' },
    ],
    categories: [
      'Current pain level (0-10)',
    ],
  },
  {
    name: 'Patient-Specific Functional Scale',
    key: 'PSFS',
    maxScore: 10,
    description: 'Patient identifies up to 5 activities and rates ability 0-10 each. Average is the score.',
    scoring: [
      { min: 0, max: 3, label: 'Severe functional limitation' },
      { min: 4, max: 5, label: 'Moderate functional limitation' },
      { min: 6, max: 7, label: 'Mild functional limitation' },
      { min: 8, max: 10, label: 'Minimal/no functional limitation' },
    ],
    categories: [
      'Patient-identified activity 1',
      'Patient-identified activity 2',
      'Patient-identified activity 3',
      'Patient-identified activity 4',
      'Patient-identified activity 5',
    ],
  },
  {
    name: 'Quick Disabilities of the Arm, Shoulder and Hand',
    key: 'QuickDASH',
    maxScore: 100,
    description: 'Shortened version of the DASH. 11 items, scored as percentage of disability.',
    scoring: [
      { min: 0, max: 20, label: 'No/little disability' },
      { min: 21, max: 40, label: 'Mild disability' },
      { min: 41, max: 60, label: 'Moderate disability' },
      { min: 61, max: 80, label: 'Severe disability' },
      { min: 81, max: 100, label: 'Extreme disability' },
    ],
    categories: [
      'Open a tight or new jar',
      'Do heavy household chores',
      'Carry a shopping bag or briefcase',
      'Wash your back',
      'Use a knife to cut food',
      'Recreational activities (force/impact through arm)',
      'Social activities interference',
      'Work/daily activity limitation',
      'Arm/shoulder/hand pain',
      'Tingling',
      'Difficulty sleeping',
    ],
  },
  {
    name: 'Patient Health Questionnaire-9',
    key: 'PHQ-9',
    maxScore: 27,
    description: 'Screens for depression severity. 9 items scored 0-3 each.',
    scoring: [
      { min: 0, max: 4, label: 'Minimal depression' },
      { min: 5, max: 9, label: 'Mild depression' },
      { min: 10, max: 14, label: 'Moderate depression' },
      { min: 15, max: 19, label: 'Moderately severe depression' },
      { min: 20, max: 27, label: 'Severe depression' },
    ],
    categories: [
      'Little interest or pleasure in doing things',
      'Feeling down, depressed, or hopeless',
      'Trouble falling or staying asleep, or sleeping too much',
      'Feeling tired or having little energy',
      'Poor appetite or overeating',
      'Feeling bad about yourself',
      'Trouble concentrating on things',
      'Moving or speaking slowly / being fidgety or restless',
      'Thoughts of self-harm',
    ],
  },
  {
    name: 'Generalized Anxiety Disorder-7',
    key: 'GAD-7',
    maxScore: 21,
    description: 'Screens for generalized anxiety severity. 7 items scored 0-3 each.',
    scoring: [
      { min: 0, max: 4, label: 'Minimal anxiety' },
      { min: 5, max: 9, label: 'Mild anxiety' },
      { min: 10, max: 14, label: 'Moderate anxiety' },
      { min: 15, max: 21, label: 'Severe anxiety' },
    ],
    categories: [
      'Feeling nervous, anxious, or on edge',
      'Not being able to stop or control worrying',
      'Worrying too much about different things',
      'Trouble relaxing',
      'Being so restless that it is hard to sit still',
      'Becoming easily annoyed or irritable',
      'Feeling afraid as if something awful might happen',
    ],
  },
];

// ── Helper Functions ──

function getInterpretation(measureType: string, score: number): string | null {
  const def = OUTCOME_MEASURE_DEFINITIONS.find(d => d.key === measureType);
  if (!def) return null;
  const bracket = def.scoring.find(s => score >= s.min && score <= s.max);
  return bracket ? bracket.label : null;
}

function calculatePercentage(score: number, maxScore: number): number {
  if (maxScore === 0) return 0;
  return Math.round((score / maxScore) * 10000) / 100;
}

function calculateScoreFromResponses(measureType: string, responses: Record<string, unknown>): { score: number; maxScore: number; percentage: number } | null {
  const def = OUTCOME_MEASURE_DEFINITIONS.find(d => d.key === measureType);
  if (!def) return null;

  const values = Object.values(responses).filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;

  let score: number;
  const maxScore = def.maxScore;

  if (measureType === 'DASH' || measureType === 'QuickDASH') {
    // DASH/QuickDASH: ((sum of n responses / n) - 1) * 25
    const sum = values.reduce((a, b) => a + b, 0);
    score = Math.round(((sum / values.length) - 1) * 25 * 100) / 100;
    score = Math.max(0, Math.min(maxScore, score));
  } else if (measureType === 'PSFS') {
    // PSFS: average of all activity ratings
    const sum = values.reduce((a, b) => a + b, 0);
    score = Math.round((sum / values.length) * 100) / 100;
    score = Math.max(0, Math.min(maxScore, score));
  } else if (measureType === 'SPADI') {
    // SPADI: sum of all items
    score = values.reduce((a, b) => a + b, 0);
    score = Math.max(0, Math.min(maxScore, score));
  } else {
    // Default: sum of all response values
    score = values.reduce((a, b) => a + b, 0);
    score = Math.max(0, Math.min(maxScore, score));
  }

  const percentage = calculatePercentage(score, maxScore);
  return { score, maxScore, percentage };
}

// ── Routes ──

// GET / - List outcome measures for a patient
router.get('/', requirePermission(Permission.OUTCOME_VIEW), async (req: Request, res: Response) => {
  try {
    const { patient_id, measure_type, date_from, date_to } = req.query;

    if (!patient_id) {
      res.status(400).json({ success: false, error: 'patient_id is required' });
      return;
    }

    let whereClause = 'om.clinic_id = $1 AND om.patient_id = $2';
    const params: unknown[] = [req.auth!.clinicId, patient_id];
    let paramIndex = 3;

    if (measure_type) {
      whereClause += ` AND om.measure_type = $${paramIndex++}`;
      params.push(measure_type);
    }
    if (date_from) {
      whereClause += ` AND om.administered_date >= $${paramIndex++}`;
      params.push(date_from);
    }
    if (date_to) {
      whereClause += ` AND om.administered_date <= $${paramIndex++}`;
      params.push(date_to);
    }

    const result = await query(
      `SELECT om.*, u.first_name as administered_by_first_name, u.last_name as administered_by_last_name
       FROM outcome_measures om
       LEFT JOIN users u ON om.administered_by = u.id
       WHERE ${whereClause}
       ORDER BY om.administered_date DESC`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /definitions - Return static list of available outcome measures
router.get('/definitions', requirePermission(Permission.OUTCOME_VIEW), async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: OUTCOME_MEASURE_DEFINITIONS });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /patient/:patientId/trends - Get trend data for graphing progress
router.get('/patient/:patientId/trends', requirePermission(Permission.OUTCOME_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT measure_type, administered_date, score, percentage
       FROM outcome_measures
       WHERE clinic_id = $1 AND patient_id = $2
       ORDER BY measure_type, administered_date ASC`,
      [req.auth!.clinicId, req.params.patientId]
    );

    // Group by measure_type
    const trends: Record<string, Array<{ date: string; score: number; percentage: number }>> = {};
    for (const row of result.rows) {
      if (!trends[row.measure_type]) {
        trends[row.measure_type] = [];
      }
      trends[row.measure_type].push({
        date: row.administered_date,
        score: parseFloat(row.score),
        percentage: parseFloat(row.percentage),
      });
    }

    res.json({ success: true, data: trends });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /:id - Get single outcome measure
router.get('/:id', requirePermission(Permission.OUTCOME_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT om.*, u.first_name as administered_by_first_name, u.last_name as administered_by_last_name
       FROM outcome_measures om
       LEFT JOIN users u ON om.administered_by = u.id
       WHERE om.id = $1 AND om.clinic_id = $2`,
      [req.params.id, req.auth!.clinicId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Outcome measure not found' });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST / - Create an outcome measure
router.post('/', requirePermission(Permission.OUTCOME_CREATE), async (req: Request, res: Response) => {
  try {
    const input = createMeasureSchema.parse(req.body);

    // Calculate percentage if not provided
    const percentage = input.percentage != null
      ? input.percentage
      : calculatePercentage(input.score, input.maxScore);

    // Derive interpretation if not provided
    const interpretation = input.interpretation || getInterpretation(input.measureType, input.score);

    const result = await query(
      `INSERT INTO outcome_measures (
        clinic_id, patient_id, note_id, measure_type, score, max_score,
        percentage, responses, administered_date, administered_by, interpretation
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        req.auth!.clinicId,
        input.patientId,
        input.noteId || null,
        input.measureType,
        input.score,
        input.maxScore,
        percentage,
        input.responses ? JSON.stringify(input.responses) : null,
        input.administeredDate,
        req.auth!.userId,
        interpretation || null,
      ]
    );

    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.OUTCOME_CREATE,
      resourceType: 'outcome_measure',
      resourceId: result.rows[0].id,
      details: {
        measureType: input.measureType,
        patientId: input.patientId,
        score: input.score,
        maxScore: input.maxScore,
      },
      req,
    });

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        percentage,
        interpretation,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /calculate - Calculate score from responses
router.post('/calculate', requirePermission(Permission.OUTCOME_VIEW), async (req: Request, res: Response) => {
  try {
    const input = calculateSchema.parse(req.body);

    const calculated = calculateScoreFromResponses(input.measureType, input.responses as Record<string, unknown>);
    if (!calculated) {
      res.status(400).json({
        success: false,
        error: 'Unable to calculate score. Check measure_type and responses.',
      });
      return;
    }

    const interpretation = getInterpretation(input.measureType, calculated.score);

    res.json({
      success: true,
      data: {
        measureType: input.measureType,
        score: calculated.score,
        maxScore: calculated.maxScore,
        percentage: calculated.percentage,
        interpretation,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid input', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
