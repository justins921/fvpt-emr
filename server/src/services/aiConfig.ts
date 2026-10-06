import crypto from 'crypto';
import { z } from 'zod';
import { config } from '../config';
import { query } from '../db';
import { logAudit } from './audit';
import { AuditAction } from '../types';
import { getLLMProvider, createProvider, LLMProvider } from './llm';

/**
 * Per-clinic AI configuration (BYOK — bring your own key).
 *
 * Each clinic stores its OWN AI provider API key, encrypted at rest with
 * AES-256-GCM using the AI_CONFIG_ENCRYPTION_KEY env var (32 bytes,
 * hex-encoded). Usage is billed by the AI provider directly to the clinic;
 * the app never sees their bill.
 *
 * Resolution order for an LLM provider at request time:
 *   1. Per-clinic encrypted key (primary)
 *   2. Env-var single-key setup (staging fallback)
 *   3. null → callers return 503 "not configured"
 *
 * The raw key is NEVER returned by any endpoint and NEVER logged.
 */

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'aicfg:v1:';

export class AIEncryptionUnavailableError extends Error {
  constructor() {
    super('AI key storage is not available — set AI_CONFIG_ENCRYPTION_KEY.');
    this.name = 'AIEncryptionUnavailableError';
  }
}

function getCryptoKey(): Buffer {
  const hex = config.AI_CONFIG_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new AIEncryptionUnavailableError();
  }
  return Buffer.from(hex, 'hex');
}

/** Whether per-clinic key storage is available (env key present and valid). */
export function isAIEncryptionAvailable(): boolean {
  try {
    getCryptoKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptApiKey(plaintext: string): string {
  const key = getCryptoKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let ct = cipher.update(plaintext, 'utf8', 'hex');
  ct += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${PREFIX}${iv.toString('hex')}:${tag}:${ct}`;
}

export function decryptApiKey(payload: string): string {
  if (!payload.startsWith(PREFIX)) {
    throw new Error('Unrecognized AI key format');
  }
  const key = getCryptoKey();
  const parts = payload.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Invalid AI key format');
  const [ivHex, tagHex, ctHex] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let pt = decipher.update(ctHex, 'hex', 'utf8');
  pt += decipher.final('utf8');
  return pt;
}

export interface ClinicAIStatus {
  configured: boolean;
  provider: 'anthropic' | 'openai' | null;
  keyHint: string;
  encryptionAvailable: boolean;
  /** Whether the env-var fallback is active (no per-clinic key). */
  usingEnvFallback: boolean;
}

const setSchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  apiKey: z.string().min(8).max(500),
});

/** Public status — never includes the raw key. */
export async function getClinicAIStatus(clinicId: string): Promise<ClinicAIStatus> {
  const encryptionAvailable = isAIEncryptionAvailable();
  const res = await query('SELECT provider, key_hint FROM clinic_ai_config WHERE clinic_id = $1', [clinicId]);
  if (res.rows.length > 0) {
    return {
      configured: true,
      provider: res.rows[0].provider,
      keyHint: res.rows[0].key_hint,
      encryptionAvailable,
      usingEnvFallback: false,
    };
  }
  // Env fallback counts as configured for feature availability.
  const envProvider = getLLMProvider();
  return {
    configured: envProvider !== null,
    provider: envProvider ? envProvider.name : null,
    keyHint: '',
    encryptionAvailable,
    usingEnvFallback: envProvider !== null,
  };
}

export async function setClinicAIConfig(
  clinicId: string,
  input: { provider: 'anthropic' | 'openai'; apiKey: string },
  userId: string
): Promise<void> {
  const parsed = setSchema.parse(input);
  // Throws AIEncryptionUnavailableError when the env key is missing — never store plaintext.
  const encrypted = encryptApiKey(parsed.apiKey.trim());
  const hint = `••••${parsed.apiKey.trim().slice(-4)}`;
  await query(
    `INSERT INTO clinic_ai_config (clinic_id, provider, encrypted_api_key, key_hint, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (clinic_id) DO UPDATE SET
       provider = EXCLUDED.provider,
       encrypted_api_key = EXCLUDED.encrypted_api_key,
       key_hint = EXCLUDED.key_hint,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [clinicId, parsed.provider, encrypted, hint, userId]
  );
  await logAudit({
    clinicId,
    userId,
    action: AuditAction.AI_CONFIG_UPDATE,
    resourceType: 'clinic',
    resourceId: clinicId,
    details: { provider: parsed.provider, action: 'set' },
  });
}

export async function clearClinicAIConfig(clinicId: string, userId: string): Promise<void> {
  await query('DELETE FROM clinic_ai_config WHERE clinic_id = $1', [clinicId]);
  await logAudit({
    clinicId,
    userId,
    action: AuditAction.AI_CONFIG_UPDATE,
    resourceType: 'clinic',
    resourceId: clinicId,
    details: { action: 'cleared' },
  });
}

/**
 * Resolve the LLM provider for a clinic: per-clinic encrypted key first,
 * env-var single-key setup as fallback, null when neither exists.
 */
export async function getLLMProviderForClinic(clinicId: string): Promise<LLMProvider | null> {
  const res = await query(
    'SELECT provider, encrypted_api_key FROM clinic_ai_config WHERE clinic_id = $1',
    [clinicId]
  );
  if (res.rows.length > 0) {
    try {
      const apiKey = decryptApiKey(res.rows[0].encrypted_api_key);
      const provider = res.rows[0].provider as 'anthropic' | 'openai';
      return createProvider(provider, apiKey);
    } catch (err) {
      // Decryption failure (e.g. key rotated) — do NOT fall through to env silently;
      // the clinic configured a key that we can no longer read. Log without details.
      console.error('Failed to decrypt clinic AI key for clinic', clinicId);
      return null;
    }
  }
  // Staging fallback: single key from env vars.
  return getLLMProvider();
}
