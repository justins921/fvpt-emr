import { query } from '../db';
import { encryptValue, isEncrypted } from '../services/phi';

export const id = '028';
export const description = 'Encrypt existing PHI at rest (SSN, DOB, diagnoses, notes)';

export async function up(): Promise<void> {
  // Fax webhook secret for authenticating inbound fax provider callbacks
  await query(`
    ALTER TABLE clinic_settings
    ADD COLUMN IF NOT EXISTS fax_webhook_secret VARCHAR(255)
  `);

  // Change date_of_birth from DATE to TEXT to hold encrypted values
  // (encrypted strings can't go in a DATE column)
  await query(`ALTER TABLE patients ALTER COLUMN date_of_birth TYPE TEXT`);

  // Encrypt patient PHI fields that are still plaintext
  const patients = await query(
    `SELECT id, ssn_last4, date_of_birth, primary_diagnosis_icd10,
            secondary_diagnoses_icd10, precautions
     FROM patients`
  );

  for (const p of patients.rows) {
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (p.ssn_last4 && !isEncrypted(p.ssn_last4)) {
      updates.push(`ssn_last4 = $${idx++}`);
      values.push(encryptValue(p.ssn_last4));
    }
    if (p.date_of_birth && !isEncrypted(String(p.date_of_birth))) {
      updates.push(`date_of_birth = $${idx++}`);
      // Convert DATE to ISO string, then encrypt
      const dobStr = p.date_of_birth instanceof Date
        ? p.date_of_birth.toISOString().split('T')[0]
        : String(p.date_of_birth);
      values.push(encryptValue(dobStr));
    }
    if (p.primary_diagnosis_icd10 && !isEncrypted(p.primary_diagnosis_icd10)) {
      updates.push(`primary_diagnosis_icd10 = $${idx++}`);
      values.push(encryptValue(p.primary_diagnosis_icd10));
    }
    if (p.precautions && !isEncrypted(p.precautions)) {
      updates.push(`precautions = $${idx++}`);
      values.push(encryptValue(p.precautions));
    }
    if (p.secondary_diagnoses_icd10 && Array.isArray(p.secondary_diagnoses_icd10)) {
      const needsEncrypt = p.secondary_diagnoses_icd10.some(
        (d: unknown) => d && !isEncrypted(d)
      );
      if (needsEncrypt) {
        updates.push(`secondary_diagnoses_icd10 = $${idx++}`);
        values.push(p.secondary_diagnoses_icd10.map((d: unknown) => encryptValue(d)));
      }
    }

    if (updates.length > 0) {
      values.push(p.id);
      await query(
        `UPDATE patients SET ${updates.join(', ')} WHERE id = $${idx}`,
        values
      );
    }
  }

  // Encrypt clinical note PHI fields
  const notes = await query(
    `SELECT id, subjective, objective, assessment, plan, eval_data, icd10_codes
     FROM clinical_notes`
  );

  for (const n of notes.rows) {
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const field of ['subjective', 'objective', 'assessment', 'plan'] as const) {
      if (n[field] && !isEncrypted(n[field])) {
        updates.push(`${field} = $${idx++}`);
        values.push(encryptValue(n[field]));
      }
    }
    if (n.eval_data && !isEncrypted(
      typeof n.eval_data === 'string' ? n.eval_data : JSON.stringify(n.eval_data)
    )) {
      updates.push(`eval_data = $${idx++}`);
      const evalStr = typeof n.eval_data === 'string' ? n.eval_data : JSON.stringify(n.eval_data);
      values.push(encryptValue(evalStr));
    }
    if (n.icd10_codes && Array.isArray(n.icd10_codes)) {
      const needsEncrypt = n.icd10_codes.some((c: unknown) => c && !isEncrypted(c));
      if (needsEncrypt) {
        updates.push(`icd10_codes = $${idx++}`);
        values.push(n.icd10_codes.map((c: unknown) => encryptValue(c)));
      }
    }

    if (updates.length > 0) {
      values.push(n.id);
      await query(
        `UPDATE clinical_notes SET ${updates.join(', ')} WHERE id = $${idx}`,
        values
      );
    }
  }

  // Encrypt patient_notes
  const pnotes = await query(`SELECT id, note_text FROM patient_notes WHERE note_text IS NOT NULL`);
  for (const n of pnotes.rows) {
    if (!isEncrypted(n.note_text)) {
      await query(
        `UPDATE patient_notes SET note_text = $1 WHERE id = $2`,
        [encryptValue(n.note_text), n.id]
      );
    }
  }
}

export async function down(): Promise<void> {
  // Decryption is not reversible via migration — restore from backup if needed
  // This is intentional: you should never bulk-decrypt PHI
}
