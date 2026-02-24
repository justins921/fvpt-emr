import crypto from 'crypto';
import { config } from '../config';

/**
 * AES-256-GCM encryption for PHI fields at rest.
 *
 * Each encrypted value includes a random IV and auth tag, stored as:
 *   enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * This allows field-level encryption of sensitive data (SSN, diagnoses, etc.)
 * while keeping non-sensitive fields queryable.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:v1:';

function getKey(): Buffer {
  const keySource = config.PHI_ENCRYPTION_KEY;
  if (!keySource || keySource.length < 32) {
    throw new Error('PHI_ENCRYPTION_KEY must be set and at least 32 characters for production');
  }
  // Derive a 256-bit key from the config value using SHA-256
  return crypto.createHash('sha256').update(keySource).digest();
}

/** Encrypt a plaintext string. Returns the tagged ciphertext. */
export function encryptField(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/** Decrypt a tagged ciphertext. Returns the original plaintext. */
export function decryptField(ciphertext: string): string {
  if (!ciphertext.startsWith(PREFIX)) {
    // Not encrypted — return as-is (supports migration from unencrypted data)
    return ciphertext;
  }

  const key = getKey();
  const parts = ciphertext.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted field format');

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** Check if a value is already encrypted. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypt a file buffer. Returns { iv, authTag, encrypted } as Buffers.
 * Used for attachment encryption.
 */
export function encryptBuffer(buffer: Uint8Array): { iv: Buffer; authTag: Buffer; encrypted: Buffer } {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { iv, authTag, encrypted };
}

/** Decrypt a file buffer using the stored IV and auth tag. */
export function decryptBuffer(encrypted: Uint8Array, iv: Uint8Array, authTag: Uint8Array): Buffer {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Encrypt a file and return a single buffer with metadata prepended:
 *   [1 byte version][16 bytes IV][16 bytes authTag][...ciphertext]
 */
export function encryptFile(plainBuffer: Uint8Array): Buffer {
  const { iv, authTag, encrypted } = encryptBuffer(plainBuffer);
  const version = Buffer.from([0x01]);
  return Buffer.concat([version, iv, authTag, encrypted]);
}

/** Decrypt a file from the combined format produced by encryptFile. */
export function decryptFile(encryptedBuffer: Uint8Array): Buffer {
  const buf = Buffer.from(encryptedBuffer.buffer, encryptedBuffer.byteOffset, encryptedBuffer.byteLength);
  const version = buf[0];
  if (version !== 0x01) throw new Error(`Unsupported encryption version: ${version}`);

  const iv = buf.subarray(1, 1 + IV_LENGTH);
  const authTag = buf.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(1 + IV_LENGTH + AUTH_TAG_LENGTH);

  return decryptBuffer(encrypted, iv, authTag);
}
