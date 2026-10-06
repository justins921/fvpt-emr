import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';

function unwrap(res: any) {
  if (!res) return {};
  return res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : res;
}

interface AIStatus {
  configured: boolean;
  provider: 'anthropic' | 'openai' | null;
  keyHint: string;
  encryptionAvailable: boolean;
  usingEnvFallback: boolean;
}

export default function AISettingsPanel() {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState<'anthropic' | 'openai' | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<any>('/settings/ai');
      const s = unwrap(res) as AIStatus;
      setStatus(s);
      if (s.provider) setProvider(s.provider);
    } catch {
      setError('Could not load AI settings.');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.put<any>('/settings/ai', { provider, apiKey });
      const s = unwrap(res) as AIStatus;
      setStatus(s);
      setApiKey('');
      setSuccess('API key saved.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setError('Key storage is not available on this server (AI_CONFIG_ENCRYPTION_KEY not set).');
      } else if (err instanceof ApiError) {
        setError(err.message || 'Save failed.');
      } else {
        setError('Save failed.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api.put<any>('/settings/ai', { clearKey: true });
      setStatus((s) => (s ? { ...s, configured: false, provider: null, keyHint: '', usingEnvFallback: false } : s));
      setSuccess('API key removed.');
    } catch {
      setError('Could not remove key.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="flex justify-center py-6">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="font-semibold mb-3">AI Features</h3>

      <p className="text-sm text-slate-600 mb-4 max-w-2xl">
        AI features are an optional add-on, included free - we charge nothing extra for them. To
        enable them, add your clinic's own API key (Anthropic or OpenAI): for your security and
        HIPAA compliance, your patient data goes directly to your AI provider under your Business
        Associate Agreement, never through our account. Your AI provider bills you separately for
        usage - that's between you and them.
      </p>

      {status && !status.encryptionAvailable && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-800 mb-4">
          <p className="font-medium">AI key storage is not available on this server.</p>
          <p className="mt-1">
            The server is missing its encryption key, so clinic API keys cannot be stored securely.
            Contact your administrator about setting AI_CONFIG_ENCRYPTION_KEY.
          </p>
        </div>
      )}

      {status?.encryptionAvailable && (
        <>
          <div className="bg-slate-50 border border-slate-200 rounded p-4 mb-4 max-w-2xl">
            <h4 className="font-medium text-sm mb-2">How to get your key</h4>
            <p className="text-sm text-slate-600 mb-3">
              <strong>Our recommendation: Anthropic (Claude).</strong> It's the strongest at this
              specific work - reading clinical notes and extracting structured, evidence-backed
              answers. It follows strict output formats reliably, which is what the code-review
              feature depends on.
            </p>
            <div className="space-y-2">
              <div className="border border-slate-200 rounded bg-white">
                <button
                  onClick={() => setGuideOpen(guideOpen === 'anthropic' ? null : 'anthropic')}
                  className="w-full text-left px-3 py-2 text-sm font-medium flex items-center justify-between"
                >
                  Anthropic setup steps <span className="text-slate-400">{guideOpen === 'anthropic' ? '▾' : '▸'}</span>
                </button>
                {guideOpen === 'anthropic' && (
                  <ol className="px-3 pb-3 text-sm text-slate-600 list-decimal list-inside space-y-1">
                    <li>Go to console.anthropic.com and create an account</li>
                    <li>Add a payment method under Billing (usage is pay-as-you-go)</li>
                    <li>Go to API Keys and create a new key</li>
                    <li>Paste the key below</li>
                    <li>Contact Anthropic about a Business Associate Agreement before using it with real patient data</li>
                  </ol>
                )}
              </div>
              <div className="border border-slate-200 rounded bg-white">
                <button
                  onClick={() => setGuideOpen(guideOpen === 'openai' ? null : 'openai')}
                  className="w-full text-left px-3 py-2 text-sm font-medium flex items-center justify-between"
                >
                  OpenAI setup steps (alternative) <span className="text-slate-400">{guideOpen === 'openai' ? '▾' : '▸'}</span>
                </button>
                {guideOpen === 'openai' && (
                  <ol className="px-3 pb-3 text-sm text-slate-600 list-decimal list-inside space-y-1">
                    <li>Go to platform.openai.com and create an account</li>
                    <li>Add billing information (usage is pay-as-you-go)</li>
                    <li>Go to API Keys and create a new key</li>
                    <li>Paste the key below</li>
                    <li>Contact OpenAI about a Business Associate Agreement before using it with real patient data</li>
                  </ol>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              This is guidance, not legal advice - confirm BAA availability with the provider
              directly and verify HIPAA compliance with your own counsel.
            </p>
          </div>

          {status.configured && !status.usingEnvFallback && (
            <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-800 mb-4 flex items-center justify-between">
              <span>
                Key configured: <strong className="capitalize">{status.provider}</strong>{' '}
                <span className="font-mono">{status.keyHint}</span>
              </span>
              <button onClick={clearKey} disabled={saving} className="text-xs text-red-600 underline">
                Remove key
              </button>
            </div>
          )}

          {status.usingEnvFallback && (
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800 mb-4">
              Using the server's shared API key (staging setup). Add your clinic's own key below to
              switch to your Business Associate Agreement coverage.
            </div>
          )}

          <div className="space-y-3 max-w-md">
            <div>
              <label className="label">AI Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as 'anthropic' | 'openai')}
                className="input"
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
              </select>
            </div>
            <div>
              <label className="label">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={status?.configured ? 'Enter a new key to replace the current one' : 'sk-...'}
                className="input font-mono"
                autoComplete="off"
              />
              <p className="text-xs text-slate-500 mt-1">
                Stored encrypted. Only the last 4 characters are ever shown back to you.
              </p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}
            <button onClick={save} disabled={saving || apiKey.trim().length < 8} className="btn-primary text-sm">
              {saving ? 'Saving...' : status?.configured ? 'Replace key' : 'Save key'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
