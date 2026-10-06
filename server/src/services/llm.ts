import { config } from '../config';

/**
 * LLM provider abstraction for AI billing features.
 *
 * Two implementations (Anthropic, OpenAI) behind one interface. The provider
 * is selected by the LLM_PROVIDER env var. When no provider/key is
 * configured, getLLMProvider() returns null and callers must degrade
 * gracefully (HTTP 503 with a setup hint).
 *
 * PHI SAFETY: prompts may contain clinical note text. This module NEVER logs
 * prompt content or completion text. Errors carry only status codes and
 * provider names, never note content.
 */

export interface LLMProvider {
  readonly name: 'anthropic' | 'openai';
  readonly model: string;
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-4o',
} as const;

class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private apiKey: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model || DEFAULT_MODELS.anthropic;
  }

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      // Never include response body — it may echo prompt content.
      throw new LLMError(`Anthropic API request failed with status ${res.status}`, res.status);
    }
    const data = (await res.json()) as any;
    const text = data?.content?.find((b: any) => b.type === 'text')?.text;
    if (typeof text !== 'string' || text.length === 0) {
      throw new LLMError('Anthropic API returned an empty completion', 502);
    }
    return text;
  }
}

class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  private apiKey: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model || DEFAULT_MODELS.openai;
  }

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      throw new LLMError(`OpenAI API request failed with status ${res.status}`, res.status);
    }
    const data = (await res.json()) as any;
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.length === 0) {
      throw new LLMError('OpenAI API returned an empty completion', 502);
    }
    return text;
  }
}

export class LLMError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = 'LLMError';
    this.statusCode = statusCode;
  }
}

/** Construct a provider instance directly (used for per-clinic decrypted keys). */
export function createProvider(
  name: 'anthropic' | 'openai',
  apiKey: string,
  model?: string
): LLMProvider {
  if (name === 'anthropic') return new AnthropicProvider(apiKey, model);
  return new OpenAIProvider(apiKey, model);
}

/**
 * Returns the configured provider, or null when LLM features are not set up.
 * Callers must handle null with a 503 + setup hint.
 */
export function getLLMProvider(): LLMProvider | null {
  const provider = config.LLM_PROVIDER;
  if (!provider) return null;
  if (provider === 'anthropic') {
    if (!config.ANTHROPIC_API_KEY) return null;
    return new AnthropicProvider(config.ANTHROPIC_API_KEY, config.LLM_MODEL);
  }
  if (provider === 'openai') {
    if (!config.OPENAI_API_KEY) return null;
    return new OpenAIProvider(config.OPENAI_API_KEY, config.LLM_MODEL);
  }
  return null;
}

/**
 * Strip patient identifiers from note text before sending to an LLM.
 * Removes common PHI patterns; the caller should already be passing only
 * clinical content, this is defense in depth.
 */
export function stripIdentifiers(text: string): string {
  return text
    // Dates like 01/15/2026 or 2026-01-15
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '[DATE]')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[DATE]')
    // Phone numbers
    .replace(/\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE]')
    // MRN-like tokens (e.g. MRN: ABC123)
    .replace(/\bMRN\s*[:#]?\s*[A-Z0-9-]+\b/gi, 'MRN: [REDACTED]')
    // Email addresses
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]');
}
