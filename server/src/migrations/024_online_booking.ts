/**
 * Migration 024 — online patient self-booking (Sports Clips model).
 *
 * Adds clinic-level booking settings and per-therapist online availability.
 * Patients can book any open slot (first-available) or pick a specific
 * therapist, depending on the clinic's booking_mode. No third-party
 * services required — bookings land directly in the appointments table.
 *
 * Tables:
 * - clinic_booking_settings: one row per clinic; master switch, mode,
 *   advance window, slot duration, daily booking window.
 * - therapist_booking_availability: which therapists accept online bookings.
 * - therapist_booking_hours: weekly hour blocks per bookable therapist.
 */
export async function up(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS clinic_booking_settings (
      clinic_id UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
      online_booking_enabled BOOLEAN NOT NULL DEFAULT false,
      booking_mode VARCHAR(20) NOT NULL DEFAULT 'both'
        CHECK (booking_mode IN ('specific_therapist', 'first_available', 'both')),
      advance_booking_days INTEGER NOT NULL DEFAULT 14
        CHECK (advance_booking_days BETWEEN 1 AND 90),
      slot_duration_minutes INTEGER NOT NULL DEFAULT 30
        CHECK (slot_duration_minutes BETWEEN 15 AND 120),
      booking_window_start TIME NOT NULL DEFAULT '08:00',
      booking_window_end TIME NOT NULL DEFAULT '17:00',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_booking_window CHECK (booking_window_end > booking_window_start)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS therapist_booking_availability (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      therapist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_bookable_online BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_booking_availability_therapist UNIQUE (clinic_id, therapist_id)
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_booking_availability_clinic
      ON therapist_booking_availability(clinic_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS therapist_booking_hours (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      availability_id UUID NOT NULL REFERENCES therapist_booking_availability(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      CONSTRAINT chk_booking_hours_range CHECK (end_time > start_time)
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_booking_hours_availability
      ON therapist_booking_hours(availability_id);
  `);
}

export async function down(client: any): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS therapist_booking_hours;`);
  await client.query(`DROP TABLE IF EXISTS therapist_booking_availability;`);
  await client.query(`DROP TABLE IF EXISTS clinic_booking_settings;`);
}
