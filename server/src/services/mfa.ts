// otplib depends on @scure/base which is ESM-only.
// TypeScript CJS compilation converts import() to require(), breaking it.
// Use Function constructor to preserve real ESM import() at runtime.
import QRCode from 'qrcode';
import { query } from '../db';
import { encryptField, decryptField } from './encryption';

const APP_NAME = 'EMR OS';

// This preserves the real ESM import() even after TypeScript compiles to CJS
const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

let otplibCache: any = null;
async function getOtplib() {
  if (!otplibCache) {
    otplibCache = await importEsm('otplib');
  }
  return otplibCache;
}

/** Generate a new MFA secret for a user (not yet enabled). */
export async function generateMfaSetup(userId: string, clinicId: string): Promise<{
  secret: string;
  qrCodeDataUrl: string;
  otpauthUrl: string;
}> {
  const { generateSecret, generateURI } = await getOtplib();
  const secret = generateSecret();

  const result = await query(
    'SELECT username FROM users WHERE id = $1 AND clinic_id = $2',
    [userId, clinicId]
  );
  if (result.rows.length === 0) throw new Error('User not found');

  const username = result.rows[0].username;
  const otpauthUrl = generateURI({ secret, issuer: APP_NAME, label: username });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  const encryptedSecret = encryptField(secret);
  await query(
    'UPDATE users SET mfa_secret = $1 WHERE id = $2 AND clinic_id = $3',
    [encryptedSecret, userId, clinicId]
  );

  return { secret, qrCodeDataUrl, otpauthUrl };
}

/** Verify a TOTP code and enable MFA if valid. Called during setup. */
export async function verifyAndEnableMfa(userId: string, clinicId: string, token: string): Promise<boolean> {
  const result = await query(
    'SELECT mfa_secret, mfa_enabled FROM users WHERE id = $1 AND clinic_id = $2',
    [userId, clinicId]
  );
  if (result.rows.length === 0) return false;

  const { mfa_secret, mfa_enabled } = result.rows[0];
  if (!mfa_secret) return false;
  if (mfa_enabled) return false;

  const secret = decryptField(mfa_secret);
  const { verifySync } = await getOtplib();
  const check = verifySync({ token, secret });

  if (check.valid) {
    await query(
      'UPDATE users SET mfa_enabled = true WHERE id = $1 AND clinic_id = $2',
      [userId, clinicId]
    );
    return true;
  }

  return false;
}

/** Verify a TOTP token during login for a user with MFA enabled. */
export async function verifyMfaToken(userId: string, token: string): Promise<boolean> {
  const result = await query(
    'SELECT mfa_secret, mfa_enabled FROM users WHERE id = $1',
    [userId]
  );
  if (result.rows.length === 0) return false;

  const { mfa_secret, mfa_enabled } = result.rows[0];
  if (!mfa_enabled || !mfa_secret) return false;

  const secret = decryptField(mfa_secret);
  const { verifySync } = await getOtplib();
  const check = verifySync({ token, secret });
  return check.valid;
}

/** Check if a user has MFA enabled. */
export async function isMfaEnabled(userId: string): Promise<boolean> {
  const result = await query(
    'SELECT mfa_enabled FROM users WHERE id = $1',
    [userId]
  );
  if (result.rows.length === 0) return false;
  return result.rows[0].mfa_enabled === true;
}

/** Disable MFA for a user (admin action). */
export async function disableMfa(userId: string, clinicId: string): Promise<void> {
  await query(
    'UPDATE users SET mfa_enabled = false, mfa_secret = NULL WHERE id = $1 AND clinic_id = $2',
    [userId, clinicId]
  );
}
