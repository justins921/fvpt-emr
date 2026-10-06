/**
 * Create the first clinic and owner/admin user for a fresh on-site deployment.
 *
 * Usage (from repo root):
 *   npm run create-admin -w server -- \
 *     --clinic "Fox Valley Physical Therapy" \
 *     --npi "1234567890" --tax-id "12-3456789" \
 *     --address "100 Main St" --city "Appleton" --state "WI" --zip "54911" \
 *     --phone "920-555-0100" \
 *     --username "admin" --password "choose-a-strong-password" \
 *     --first-name "Jane" --last-name "Doe"
 *
 * Do NOT use the demo seed (npm run seed) for production — it creates
 * fake patients and staff.
 */
import { pool } from '../db';
import { hashPassword } from '../services/auth';

function arg(name: string, required = true): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || !process.argv[idx + 1]) {
    if (required) {
      console.error(`Missing required argument: --${name}`);
      process.exit(1);
    }
    return '';
  }
  return process.argv[idx + 1];
}

async function main() {
  const clinicName = arg('clinic');
  const username = arg('username');
  const password = arg('password');
  const firstName = arg('first-name');
  const lastName = arg('last-name');

  if (password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    // Create clinic
    const clinicRes = await client.query(
      `INSERT INTO clinics (name, npi, tax_id, address_line1, address_line2, city, state, zip, phone, fax)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        clinicName,
        arg('npi'),
        arg('tax-id'),
        arg('address'),
        arg('address2', false) || null,
        arg('city'),
        arg('state'),
        arg('zip'),
        arg('phone'),
        arg('fax', false) || null,
      ]
    );
    const clinicId = clinicRes.rows[0].id;
    console.log(`Clinic created: ${clinicName} (${clinicId})`);

    // Create owner user
    const passwordHash = await hashPassword(password);
    await client.query(
      `INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5, 'owner')`,
      [clinicId, username, passwordHash, firstName, lastName]
    );
    console.log(`Owner user created: ${username}`);
    console.log('\nDone. Log in at your clinic URL with these credentials.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
