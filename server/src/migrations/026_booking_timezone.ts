/**
 * Migration 026 — add timezone to clinic_booking_settings.
 *
 * The timezone column was added to migration 024 after it had already
 * run in production. This follow-up adds it for existing deployments.
 */
export async function up(client: any): Promise<void> {
  await client.query(`
    ALTER TABLE clinic_booking_settings
    ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'America/Chicago';
  `);
}

export async function down(client: any): Promise<void> {
  await client.query(`
    ALTER TABLE clinic_booking_settings
    DROP COLUMN IF EXISTS timezone;
  `);
}
