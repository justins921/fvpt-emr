import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validateSession, requirePermission, tenantScope } from '../middleware/auth';
import { authenticatePortalUser, requireActivePortalUser } from './portal';
import { query } from '../db';
import { Permission, AuditAction, AppointmentType } from '../types';
import { logAudit } from '../services/audit';

/**
 * Online patient self-booking (Sports Clips model).
 *
 * Two routers in one file:
 *  - staffRouter: clinic booking settings + per-therapist availability.
 *    Mounted at /api/online-booking. Requires staff auth + schedule perms.
 *  - portalRouter: patient-facing slot lookup + booking.
 *    Mounted at /api/portal/booking. Uses portal JWT, scoped to the
 *    patient's own clinic. No third-party services involved.
 */

const staffRouter = Router();
staffRouter.use(authenticate, validateSession, tenantScope);

// ── Timezone helpers ────────────────────────────────────────────────────────
// Vercel runs in UTC; clinics are in their own timezone. All slot times are
// interpreted in the clinic's timezone, then converted to UTC for storage.

function getTimezoneOffsetMs(timezone: string, date: Date): number {
  // Returns the offset in ms to ADD to UTC to get wall-clock time in tz.
  // Uses Intl to find what wall-clock time a UTC instant shows as in tz.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '0';
  const asUTC = Date.UTC(
    Number(get('year')), Number(get('month')) - 1, Number(get('day')),
    Number(get('hour')), Number(get('minute')), Number(get('second'))
  );
  return asUTC - date.getTime();
}

function zonedTimeToUtc(timezone: string, dateStr: string, hours: number, minutes: number): Date {
  // dateStr: 'YYYY-MM-DD', hours/minutes: wall-clock time in tz.
  // Returns the UTC Date for that wall-clock time.
  const [y, m, d] = dateStr.split('-').map(Number);
  // Start with a guess: treat wall-clock as UTC, then correct by the offset.
  let utc = new Date(Date.UTC(y, m - 1, d, hours, minutes, 0, 0));
  const offset = getTimezoneOffsetMs(timezone, utc);
  utc = new Date(utc.getTime() - offset);
  // One refinement pass for DST edge cases.
  const offset2 = getTimezoneOffsetMs(timezone, utc);
  if (offset2 !== offset) utc = new Date(utc.getTime() - (offset2 - offset));
  return utc;
}

function getDayOfWeekInTz(timezone: string, dateStr: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  // Use noon UTC to avoid date-boundary issues.
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = dtf.format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day);
}

// ── Settings ────────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  online_booking_enabled: z.boolean(),
  booking_mode: z.enum(['specific_therapist', 'first_available', 'both']),
  advance_booking_days: z.number().int().min(1).max(90),
  slot_duration_minutes: z.number().int().min(15).max(120),
  booking_window_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  booking_window_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).max(50).optional(),
});

staffRouter.get('/settings', requirePermission(Permission.SCHEDULE_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT clinic_id, online_booking_enabled, booking_mode, advance_booking_days,
              slot_duration_minutes,
              to_char(booking_window_start, 'HH24:MI') AS booking_window_start,
              to_char(booking_window_end, 'HH24:MI') AS booking_window_end
       FROM clinic_booking_settings WHERE clinic_id = $1`,
      [req.auth!.clinicId]
    );
    if (result.rows.length === 0) {
      res.json({
        success: true,
        data: {
          online_booking_enabled: false,
          booking_mode: 'both',
          advance_booking_days: 14,
          slot_duration_minutes: 30,
          booking_window_start: '08:00',
          booking_window_end: '17:00',
        },
      });
      return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

staffRouter.put('/settings', requirePermission(Permission.SCHEDULE_EDIT), async (req: Request, res: Response) => {
  try {
    const input = settingsSchema.parse(req.body);
    if (input.booking_window_end <= input.booking_window_start) {
      res.status(400).json({ success: false, error: 'Booking window end must be after start' });
      return;
    }
    await query(
      `INSERT INTO clinic_booking_settings
         (clinic_id, online_booking_enabled, booking_mode, advance_booking_days,
          slot_duration_minutes, booking_window_start, booking_window_end, timezone, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::time, $7::time, $8, NOW())
       ON CONFLICT (clinic_id) DO UPDATE SET
         online_booking_enabled = EXCLUDED.online_booking_enabled,
         booking_mode = EXCLUDED.booking_mode,
         advance_booking_days = EXCLUDED.advance_booking_days,
         slot_duration_minutes = EXCLUDED.slot_duration_minutes,
         booking_window_start = EXCLUDED.booking_window_start,
         booking_window_end = EXCLUDED.booking_window_end,
         timezone = EXCLUDED.timezone,
         updated_at = NOW()`,
      [
        req.auth!.clinicId,
        input.online_booking_enabled,
        input.booking_mode,
        input.advance_booking_days,
        input.slot_duration_minutes,
        input.booking_window_start,
        input.booking_window_end,
        input.timezone || 'America/Chicago',
      ]
    );
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.SETTINGS_CHANGE,
      resourceType: 'clinic_booking_settings',
      resourceId: req.auth!.clinicId,
      req,
    });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid settings' });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Therapist availability ──────────────────────────────────────────────────

staffRouter.get('/therapists', requirePermission(Permission.SCHEDULE_VIEW), async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT u.id, u.first_name, u.last_name, u.credential, u.role,
              COALESCE(tba.is_bookable_online, false) AS is_bookable_online,
              tba.id AS availability_id
       FROM users u
       LEFT JOIN therapist_booking_availability tba
         ON tba.therapist_id = u.id AND tba.clinic_id = $1
       WHERE u.clinic_id = $1 AND u.is_active = true
         AND u.role IN ('therapist', 'admin', 'owner')
       ORDER BY u.last_name, u.first_name`,
      [req.auth!.clinicId]
    );
    // Attach weekly hours for each therapist that has an availability row
    for (const row of result.rows) {
      if (row.availability_id) {
        const hours = await query(
          `SELECT id, day_of_week,
                  to_char(start_time, 'HH24:MI') AS start_time,
                  to_char(end_time, 'HH24:MI') AS end_time
           FROM therapist_booking_hours
           WHERE availability_id = $1
           ORDER BY day_of_week, start_time`,
          [row.availability_id]
        );
        row.hours = hours.rows;
      } else {
        row.hours = [];
      }
      delete row.availability_id;
    }
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const hoursBlockSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

const therapistAvailabilitySchema = z.object({
  is_bookable_online: z.boolean(),
  hours: z.array(hoursBlockSchema).max(28),
});

staffRouter.put('/therapists/:id', requirePermission(Permission.SCHEDULE_EDIT), async (req: Request, res: Response) => {
  try {
    const input = therapistAvailabilitySchema.parse(req.body);
    for (const h of input.hours) {
      if (h.end_time <= h.start_time) {
        res.status(400).json({ success: false, error: 'Each time block end must be after its start' });
        return;
      }
    }
    // Verify the therapist belongs to this clinic
    const userCheck = await query(
      `SELECT id FROM users WHERE id = $1 AND clinic_id = $2 AND is_active = true`,
      [req.params.id, req.auth!.clinicId]
    );
    if (userCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Therapist not found' });
      return;
    }
    const avail = await query(
      `INSERT INTO therapist_booking_availability (clinic_id, therapist_id, is_bookable_online, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (clinic_id, therapist_id) DO UPDATE SET
         is_bookable_online = EXCLUDED.is_bookable_online,
         updated_at = NOW()
       RETURNING id`,
      [req.auth!.clinicId, req.params.id, input.is_bookable_online]
    );
    const availabilityId = avail.rows[0].id;
    await query(`DELETE FROM therapist_booking_hours WHERE availability_id = $1`, [availabilityId]);
    for (const h of input.hours) {
      await query(
        `INSERT INTO therapist_booking_hours (availability_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3::time, $4::time)`,
        [availabilityId, h.day_of_week, h.start_time, h.end_time]
      );
    }
    await logAudit({
      clinicId: req.auth!.clinicId,
      userId: req.auth!.userId,
      action: AuditAction.SETTINGS_CHANGE,
      resourceType: 'therapist_booking_availability',
      resourceId: req.params.id,
      req,
    });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid availability' });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Portal (patient-facing) ─────────────────────────────────────────────────

const portalRouter = Router();
portalRouter.use(authenticatePortalUser, requireActivePortalUser);

interface BookingSettings {
  online_booking_enabled: boolean;
  booking_mode: string;
  advance_booking_days: number;
  slot_duration_minutes: number;
  booking_window_start: string;
  booking_window_end: string;
  timezone: string;
}

async function getSettings(clinicId: string): Promise<BookingSettings | null> {
  const result = await query(
    `SELECT online_booking_enabled, booking_mode, advance_booking_days,
            slot_duration_minutes,
            to_char(booking_window_start, 'HH24:MI') AS booking_window_start,
            to_char(booking_window_end, 'HH24:MI') AS booking_window_end,
            timezone
     FROM clinic_booking_settings WHERE clinic_id = $1`,
    [clinicId]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

interface SlotTherapist {
  id: string;
  first_name: string;
  last_name: string;
  credential: string | null;
}

/** Build candidate slot start times (minutes since midnight) for a date. */
function buildSlots(windowStart: string, windowEnd: string, slotMinutes: number): number[] {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const start = toMin(windowStart);
  const end = toMin(windowEnd);
  const slots: number[] = [];
  for (let m = start; m + slotMinutes <= end; m += slotMinutes) slots.push(m);
  return slots;
}

/**
 * GET /slots?date=YYYY-MM-DD&therapist_id=optional
 * Returns bookable slots. In first_available mode without a therapist_id,
 * slots are returned without naming the therapist (assigned at booking).
 */
portalRouter.get('/slots', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    void patientId;
    const dateParam = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
      return;
    }
    const settings = await getSettings(clinicId);
    if (!settings || !settings.online_booking_enabled) {
      res.status(403).json({ success: false, error: 'Online booking is not enabled for this clinic' });
      return;
    }

    const tz = settings.timezone || 'America/Chicago';
    // "Today" in the clinic's timezone, as YYYY-MM-DD.
    const nowUtc = new Date();
    const tzNow = new Date(nowUtc.getTime() + getTimezoneOffsetMs(tz, nowUtc));
    const todayStr = tzNow.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam) || isNaN(new Date(dateParam + 'T00:00:00Z').getTime())) {
      res.status(400).json({ success: false, error: 'Invalid date' });
      return;
    }
    const daysOut = Math.round(
      (new Date(dateParam + 'T00:00:00Z').getTime() - new Date(todayStr + 'T00:00:00Z').getTime()) / 86400000
    );
    if (daysOut < 0 || daysOut > settings.advance_booking_days) {
      res.status(400).json({ success: false, error: 'Date is outside the booking window' });
      return;
    }

    const therapistId = req.query.therapist_id ? String(req.query.therapist_id) : null;
    const hideTherapist = settings.booking_mode === 'first_available' && !therapistId;

    // Bookable therapists for this clinic (optionally filtered to one)
    let therapistSql = `
      SELECT u.id, u.first_name, u.last_name, u.credential, tba.id AS availability_id
      FROM users u
      JOIN therapist_booking_availability tba
        ON tba.therapist_id = u.id AND tba.clinic_id = $1
      WHERE u.clinic_id = $1 AND u.is_active = true AND tba.is_bookable_online = true
    `;
    const therapistParams: unknown[] = [clinicId];
    if (therapistId) {
      if (!/^[0-9a-f-]{36}$/i.test(therapistId)) {
        res.status(400).json({ success: false, error: 'Invalid therapist_id' });
        return;
      }
      therapistSql += ` AND u.id = $2`;
      therapistParams.push(therapistId);
    }
    const therapists = await query(therapistSql, therapistParams);
    if (therapists.rows.length === 0) {
      res.json({ success: true, data: { slots: [], therapists: [] } });
      return;
    }

    const dayOfWeek = getDayOfWeekInTz(tz, dateParam);
    const dayStart = zonedTimeToUtc(tz, dateParam, 0, 0);
    const dayEnd = zonedTimeToUtc(tz, dateParam, 23, 59);

    // Existing non-cancelled appointments for these therapists that day
    const appts = await query(
      `SELECT therapist_id, start_time, end_time FROM appointments
       WHERE clinic_id = $1 AND therapist_id = ANY($2)
         AND status NOT IN ('cancelled', 'no_show')
         AND start_time < $4 AND end_time > $3`,
      [clinicId, therapists.rows.map((t: SlotTherapist & { availability_id: string }) => t.id), dayStart.toISOString(), dayEnd.toISOString()]
    );
    const busyByTherapist = new Map<string, { start: number; end: number }[]>();
    for (const a of appts.rows) {
      const list = busyByTherapist.get(a.therapist_id) || [];
      list.push({ start: new Date(a.start_time).getTime(), end: new Date(a.end_time).getTime() });
      busyByTherapist.set(a.therapist_id, list);
    }

    const candidateSlots = buildSlots(settings.booking_window_start, settings.booking_window_end, settings.slot_duration_minutes);
    const now = Date.now();

    // For each therapist, determine their bookable hours today + free slots
    const slotMap = new Map<number, { therapist: SlotTherapist; startISO: string }[]>();
    for (const t of therapists.rows) {
      const hoursRes = await query(
        `SELECT to_char(start_time, 'HH24:MI') AS start_time,
                to_char(end_time, 'HH24:MI') AS end_time
         FROM therapist_booking_hours
         WHERE availability_id = $1 AND day_of_week = $2`,
        [t.availability_id, dayOfWeek]
      );
      if (hoursRes.rows.length === 0) continue;
      const busy = busyByTherapist.get(t.id) || [];
      for (const block of hoursRes.rows) {
        const toMin = (s: string) => {
          const [h, m] = s.split(':').map(Number);
          return h * 60 + m;
        };
        const blockStart = toMin(block.start_time);
        const blockEnd = toMin(block.end_time);
        for (const slotMin of candidateSlots) {
          if (slotMin < blockStart || slotMin + settings.slot_duration_minutes > blockEnd) continue;
          const slotStart = zonedTimeToUtc(tz, dateParam, Math.floor(slotMin / 60), slotMin % 60);
          if (slotStart.getTime() <= now) continue; // no past slots
          const slotEndMs = slotStart.getTime() + settings.slot_duration_minutes * 60000;
          const overlaps = busy.some((b) => slotStart.getTime() < b.end && slotEndMs > b.start);
          if (overlaps) continue;
          const key = slotStart.getTime();
          const list = slotMap.get(key) || [];
          list.push({
            therapist: { id: t.id, first_name: t.first_name, last_name: t.last_name, credential: t.credential },
            startISO: slotStart.toISOString(),
          });
          slotMap.set(key, list);
        }
      }
    }

    const slots = [...slotMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ms, options]) => ({
        start: new Date(ms).toISOString(),
        therapists: hideTherapist ? [] : options.map((o) => o.therapist),
        first_available: hideTherapist,
      }));

    res.json({
      success: true,
      data: {
        slots,
        booking_mode: settings.booking_mode,
        slot_duration_minutes: settings.slot_duration_minutes,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/** GET /therapists — bookable therapists for the patient's clinic (for the picker). */
portalRouter.get('/therapists', async (req: Request, res: Response) => {
  try {
    const { clinicId } = req.portal!;
    const settings = await getSettings(clinicId);
    if (!settings || !settings.online_booking_enabled) {
      res.status(403).json({ success: false, error: 'Online booking is not enabled for this clinic' });
      return;
    }
    if (settings.booking_mode === 'first_available') {
      res.json({ success: true, data: { therapists: [], booking_mode: settings.booking_mode } });
      return;
    }
    const result = await query(
      `SELECT u.id, u.first_name, u.last_name, u.credential
       FROM users u
       JOIN therapist_booking_availability tba
         ON tba.therapist_id = u.id AND tba.clinic_id = $1
       WHERE u.clinic_id = $1 AND u.is_active = true AND tba.is_bookable_online = true
       ORDER BY u.last_name, u.first_name`,
      [clinicId]
    );
    res.json({ success: true, data: { therapists: result.rows, booking_mode: settings.booking_mode } });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const bookSchema = z.object({
  slot_start: z.string().datetime(),
  therapist_id: z.string().uuid().optional().nullable(),
  appointment_type: z.nativeEnum(AppointmentType),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * POST /book — book a slot. Re-validates availability to guard against races.
 * In first_available mode without a therapist_id, assigns the bookable
 * therapist with the fewest appointments that day.
 */
portalRouter.post('/book', async (req: Request, res: Response) => {
  try {
    const { patientId, clinicId } = req.portal!;
    const input = bookSchema.parse(req.body);
    const settings = await getSettings(clinicId);
    if (!settings || !settings.online_booking_enabled) {
      res.status(403).json({ success: false, error: 'Online booking is not enabled for this clinic' });
      return;
    }

    const slotStart = new Date(input.slot_start);
    if (isNaN(slotStart.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid slot_start' });
      return;
    }
    const tz = settings.timezone || 'America/Chicago';
    const now = Date.now();
    if (slotStart.getTime() <= now) {
      res.status(400).json({ success: false, error: 'That time slot has already passed' });
      return;
    }
    // "Today" in the clinic's timezone for advance-day calculation.
    const tzNow = new Date(now + getTimezoneOffsetMs(tz, new Date(now)));
    const todayStr = tzNow.toISOString().slice(0, 10);
    const slotDateStr = new Date(slotStart.getTime() + getTimezoneOffsetMs(tz, slotStart)).toISOString().slice(0, 10);
    const daysOut = Math.round(
      (new Date(slotDateStr + 'T00:00:00Z').getTime() - new Date(todayStr + 'T00:00:00Z').getTime()) / 86400000
    );
    if (daysOut < 0 || daysOut > settings.advance_booking_days) {
      res.status(400).json({ success: false, error: 'Date is outside the booking window' });
      return;
    }

    // Slot must align with the clinic's slot grid (in clinic timezone)
    const tzSlot = new Date(slotStart.getTime() + getTimezoneOffsetMs(tz, slotStart));
    const slotMin = tzSlot.getUTCHours() * 60 + tzSlot.getUTCMinutes();
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const windowStartMin = toMin(settings.booking_window_start);
    if (slotMin < windowStartMin || (slotMin - windowStartMin) % settings.slot_duration_minutes !== 0) {
      res.status(400).json({ success: false, error: 'Invalid time slot' });
      return;
    }

    const dayOfWeek = slotStart.getDay();

    // Resolve the therapist
    let therapistId = input.therapist_id || null;
    if (therapistId) {
      if (settings.booking_mode === 'first_available') {
        res.status(400).json({ success: false, error: 'This clinic assigns your therapist at booking' });
        return;
      }
      const check = await query(
        `SELECT tba.id FROM therapist_booking_availability tba
         JOIN users u ON u.id = tba.therapist_id
         WHERE tba.clinic_id = $1 AND tba.therapist_id = $2
           AND tba.is_bookable_online = true AND u.is_active = true`,
        [clinicId, therapistId]
      );
      if (check.rows.length === 0) {
        res.status(400).json({ success: false, error: 'Therapist is not available for online booking' });
        return;
      }
      // Verify the requested slot falls inside that therapist's hours
      const hoursRes = await query(
        `SELECT to_char(start_time, 'HH24:MI') AS start_time,
                to_char(end_time, 'HH24:MI') AS end_time
         FROM therapist_booking_hours
         WHERE availability_id = $1 AND day_of_week = $2
           AND start_time <= $3::time
           AND end_time >= ($3::time + ($4 || ' minutes')::interval)`,
        [check.rows[0].id, dayOfWeek, slotStart.toTimeString().slice(0, 8), settings.slot_duration_minutes]
      );
      if (hoursRes.rows.length === 0) {
        res.status(400).json({ success: false, error: 'That time is outside this therapist\'s booking hours' });
        return;
      }
    } else {
      if (settings.booking_mode === 'specific_therapist') {
        res.status(400).json({ success: false, error: 'Please choose a therapist' });
        return;
      }
      // First-available: find bookable therapists whose hours cover the slot,
      // pick the one with the fewest appointments that day.
      const candidates = await query(
        `SELECT u.id, u.first_name, u.last_name,
                COUNT(a.id)::int AS appt_count
         FROM users u
         JOIN therapist_booking_availability tba
           ON tba.therapist_id = u.id AND tba.clinic_id = $1
         JOIN therapist_booking_hours tbh
           ON tbh.availability_id = tba.id AND tbh.day_of_week = $2
          AND tbh.start_time <= $3::time
          AND tbh.end_time >= ($3::time + ($4 || ' minutes')::interval)
         LEFT JOIN appointments a
           ON a.therapist_id = u.id AND a.clinic_id = $1
          AND a.status NOT IN ('cancelled', 'no_show')
          AND a.start_time >= $5 AND a.start_time < $6
         WHERE u.clinic_id = $1 AND u.is_active = true AND tba.is_bookable_online = true
         GROUP BY u.id
         ORDER BY appt_count ASC, u.last_name
         LIMIT 1`,
        [
          clinicId,
          dayOfWeek,
          slotStart.toTimeString().slice(0, 8),
          settings.slot_duration_minutes,
          new Date(slotStart.getFullYear(), slotStart.getMonth(), slotStart.getDate()).toISOString(),
          new Date(slotStart.getFullYear(), slotStart.getMonth(), slotStart.getDate() + 1).toISOString(),
        ]
      );
      if (candidates.rows.length === 0) {
        res.status(400).json({ success: false, error: 'No therapist is available at that time' });
        return;
      }
      therapistId = candidates.rows[0].id;
    }

    // Race check: slot must still be free for the chosen therapist
    const slotEnd = new Date(slotStart.getTime() + settings.slot_duration_minutes * 60000);
    const conflict = await query(
      `SELECT 1 FROM appointments
       WHERE clinic_id = $1 AND therapist_id = $2
         AND status NOT IN ('cancelled', 'no_show')
         AND start_time < $4 AND end_time > $3
       LIMIT 1`,
      [clinicId, therapistId, slotStart.toISOString(), slotEnd.toISOString()]
    );
    if (conflict.rows.length > 0) {
      res.status(409).json({ success: false, error: 'That time was just taken. Please pick another slot.' });
      return;
    }

    const created = await query(
      `INSERT INTO appointments
         (clinic_id, patient_id, therapist_id, start_time, end_time, appointment_type, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', $7)
       RETURNING id, start_time, end_time`,
      [
        clinicId,
        patientId,
        therapistId,
        slotStart.toISOString(),
        slotEnd.toISOString(),
        input.appointment_type,
        input.notes?.trim() || null,
      ]
    );

    const therapistName = await query(
      `SELECT first_name, last_name, credential FROM users WHERE id = $1`,
      [therapistId]
    );
    const tn = therapistName.rows[0];
    if (!tn) {
      res.status(500).json({ success: false, error: 'Could not load therapist details' });
      return;
    }

    res.status(201).json({
      success: true,
      data: {
        id: created.rows[0].id,
        start_time: created.rows[0].start_time,
        end_time: created.rows[0].end_time,
        therapist: {
          id: therapistId,
          name: `${tn.first_name} ${tn.last_name}${tn.credential ? `, ${tn.credential}` : ''}`,
        },
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid booking request' });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export { staffRouter as onlineBookingRouter, portalRouter as portalBookingRouter };
