import { query } from '../db';

export const id = '027';
export const description = 'Payment processor configuration (pluggable gateways)';

export async function up(): Promise<void> {
  // Clinic-level processor configuration
  await query(`
    ALTER TABLE clinic_settings
    ADD COLUMN IF NOT EXISTS payment_processor VARCHAR(50),
    ADD COLUMN IF NOT EXISTS payment_merchant_id VARCHAR(255)
  `);

  // Track which processor handled each transaction
  await query(`
    ALTER TABLE payment_transactions
    ADD COLUMN IF NOT EXISTS processor VARCHAR(50)
  `);
}

export async function down(): Promise<void> {
  await query(`ALTER TABLE clinic_settings DROP COLUMN IF EXISTS payment_processor`);
  await query(`ALTER TABLE clinic_settings DROP COLUMN IF EXISTS payment_merchant_id`);
  await query(`ALTER TABLE payment_transactions DROP COLUMN IF EXISTS processor`);
}
