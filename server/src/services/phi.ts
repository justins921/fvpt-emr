/**
 * PHI Field Encryption Helper
 *
 * Defines which fields contain PHI and must be encrypted at rest,
 * and provides helpers to encrypt/decrypt records transparently.
 *
 * ENCRYPTED (sensitive clinical data):
 * - SSN, DOB, diagnoses, precautions
 * - Note bodies, intake responses
 *
 * NOT ENCRYPTED (needed for search/display, lower sensitivity):
 * - Names, phone, email, MRN, address
 * - These remain queryable with LIKE/ILIKE
 *
 * The encryption uses AES-256-GCM via the existing encryption service.
 * Encrypted values are tagged with 'enc:v1:' prefix for identification.
 */

import { encryptField, decryptField } from './encryption';

/** Fields in the patients table that must be encrypted */
export const ENCRYPTED_PATIENT_FIELDS = [
  'ssn_last4',
  'date_of_birth',
  'primary_diagnosis_icd10',
  'precautions',
] as const;

/** Fields in patient_notes that must be encrypted */
export const ENCRYPTED_NOTE_FIELDS = [
  'subjective',
  'objective',
  'assessment',
  'plan',
  'content', // Generic content field if present
] as const;

/** Fields in intake_responses that must be encrypted */
export const ENCRYPTED_INTAKE_FIELDS = [
  'responses', // JSON blob of form answers
] as const;

type PatientField = typeof ENCRYPTED_PATIENT_FIELDS[number];

/**
 * Check if a value is already encrypted (has the enc:v1: prefix)
 */
export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('enc:v1:');
}

/**
 * Encrypt a single field value. Skips null/undefined/empty.
 * Skips already-encrypted values (idempotent).
 */
export function encryptValue(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return value;
  if (isEncrypted(value)) return value;
  if (typeof value !== 'string') value = String(value);
  return encryptField(value as string);
}

/**
 * Decrypt a single field value. Skips null/undefined.
 * Passes through unencrypted values (for migration period).
 */
export function decryptValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (!isEncrypted(value)) return value; // Not encrypted yet, pass through
  try {
    return decryptField(value as string);
  } catch {
    // If decryption fails, return as-is (don't break the app)
    return value;
  }
}

/**
 * Encrypt PHI fields in a patient record before INSERT/UPDATE.
 * Mutates a copy, does not modify the original.
 */
export function encryptPatientRecord<T extends Record<string, unknown>>(record: T): T {
  const encrypted = { ...record };
  for (const field of ENCRYPTED_PATIENT_FIELDS) {
    if (field in encrypted) {
      (encrypted as Record<string, unknown>)[field] = encryptValue(encrypted[field]);
    }
  }
  // Handle secondary_diagnoses array
  if ('secondary_diagnoses_icd10' in encrypted && Array.isArray(encrypted.secondary_diagnoses_icd10)) {
    (encrypted as Record<string, unknown>).secondary_diagnoses_icd10 =
      (encrypted.secondary_diagnoses_icd10 as string[]).map(d => encryptValue(d));
  }
  return encrypted;
}

/**
 * Decrypt PHI fields in a patient record after SELECT.
 */
export function decryptPatientRecord<T extends Record<string, unknown>>(record: T): T {
  if (!record) return record;
  const decrypted = { ...record };
  for (const field of ENCRYPTED_PATIENT_FIELDS) {
    if (field in decrypted) {
      (decrypted as Record<string, unknown>)[field] = decryptValue(decrypted[field]);
    }
  }
  if ('secondary_diagnoses_icd10' in decrypted && Array.isArray(decrypted.secondary_diagnoses_icd10)) {
    (decrypted as Record<string, unknown>).secondary_diagnoses_icd10 =
      (decrypted.secondary_diagnoses_icd10 as unknown[]).map(d => decryptValue(d));
  }
  return decrypted;
}

/**
 * Decrypt PHI fields in an array of patient records.
 */
export function decryptPatientRecords<T extends Record<string, unknown>>(records: T[]): T[] {
  return records.map(decryptPatientRecord);
}

/**
 * Encrypt PHI fields in a clinical note before INSERT/UPDATE.
 */
export function encryptNoteRecord<T extends Record<string, unknown>>(record: T): T {
  const encrypted = { ...record };
  for (const field of ENCRYPTED_NOTE_FIELDS) {
    if (field in encrypted) {
      (encrypted as Record<string, unknown>)[field] = encryptValue(encrypted[field]);
    }
  }
  return encrypted;
}

/**
 * Decrypt PHI fields in a clinical note after SELECT.
 * Handles eval_data (encrypted JSON string) and icd10_codes (encrypted array).
 */
export function decryptNoteRecord<T extends Record<string, unknown>>(record: T): T {
  if (!record) return record;
  const decrypted = { ...record };
  for (const field of ENCRYPTED_NOTE_FIELDS) {
    if (field in decrypted) {
      (decrypted as Record<string, unknown>)[field] = decryptValue(decrypted[field]);
    }
  }
  // eval_data is stored as encrypted JSON string — decrypt then parse
  if ('eval_data' in decrypted && decrypted.eval_data) {
    const decryptedStr = decryptValue(decrypted.eval_data);
    if (typeof decryptedStr === 'string' && decryptedStr !== decrypted.eval_data) {
      try {
        (decrypted as Record<string, unknown>).eval_data = JSON.parse(decryptedStr);
      } catch {
        (decrypted as Record<string, unknown>).eval_data = decryptedStr;
      }
    }
  }
  // icd10_codes is an array of encrypted strings
  if ('icd10_codes' in decrypted && Array.isArray(decrypted.icd10_codes)) {
    (decrypted as Record<string, unknown>).icd10_codes =
      (decrypted.icd10_codes as unknown[]).map(c => decryptValue(c));
  }
  return decrypted;
}

/**
 * Decrypt PHI fields in an array of note records.
 */
export function decryptNoteRecords<T extends Record<string, unknown>>(records: T[]): T[] {
  return records.map(decryptNoteRecord);
}
