import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';

function unwrap(res: any) {
  if (!res) return null;
  if (res.data && typeof res.data === 'object' && !Array.isArray(res.data)) return res.data;
  return res;
}

function unwrapList(res: any): any[] {
  const d = unwrap(res);
  return Array.isArray(d) ? d : [];
}

interface DenialReason {
  source: 'era' | 'manual';
  cpt_code: string | null;
  reason_code: string | null;
  description: string | null;
  paid_cents: number;
  billed_cents: number;
}

interface AppealDraft {
  id: string;
  claim_id: string;
  denial_reasons: DenialReason[];
  draft_text: string;
  provider: string;
  model: string;
  status: 'draft' | 'edited' | 'sent';
  created_by: string | null;
  author_name?: string | null;
  created_at: string;
}

const statusStyle: Record<string, string> = {
  draft: 'badge-gray',
  edited: 'badge-yellow',
  sent: 'badge-green',
};

export default function AppealDraftPanel({ claimId, onClose }: { claimId: string; onClose: () => void }) {
  const [drafts, setDrafts] = useState<AppealDraft[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [llmMissing, setLlmMissing] = useState(false);
  const [showConfirmSend, setShowConfirmSend] = useState(false);
  const [manualReason, setManualReason] = useState({ reason_code: '', description: '', cpt_code: '' });

  const active = drafts.find((d) => d.id === activeId) || null;

  async function loadDrafts() {
    setLoadingList(true);
    try {
      const res = await api.get<any>(`/billing/claims/${claimId}/appeal-drafts`);
      const list = unwrapList(res);
      setDrafts(list);
      if (list.length > 0 && !activeId) {
        setActiveId(list[0].id);
        setEditText(list[0].draft_text);
      }
    } catch {
      setError('Could not load appeal drafts.');
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId]);

  useEffect(() => {
    if (active) setEditText(active.draft_text);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generateDraft() {
    setLoading(true);
    setError(null);
    setLlmMissing(false);
    try {
      const body: any = {};
      const mr = manualReason;
      if (mr.reason_code.trim() || mr.description.trim()) {
        body.denial_reasons = [
          {
            reason_code: mr.reason_code.trim() || null,
            description: mr.description.trim() || null,
            cpt_code: mr.cpt_code.trim() || null,
          },
        ];
      }
      const res = await api.post<any>(`/billing/claims/${claimId}/appeal-draft`, body);
      const draft = unwrap(res) as AppealDraft;
      setDrafts((prev) => [draft, ...prev]);
      setActiveId(draft.id);
      setEditText(draft.draft_text);
      setManualReason({ reason_code: '', description: '', cpt_code: '' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setLlmMissing(true);
      } else if (err instanceof ApiError) {
        setError(err.message || 'Draft generation failed.');
      } else {
        setError('Draft generation failed.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function saveEdits() {
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.put<any>(`/billing/appeal-drafts/${active.id}`, { draft_text: editText });
      const updated = unwrap(res) as AppealDraft;
      setDrafts((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message || 'Save failed.' : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function markSent() {
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.put<any>(`/billing/appeal-drafts/${active.id}`, {
        draft_text: editText,
        status: 'sent',
      });
      const updated = unwrap(res) as AppealDraft;
      setDrafts((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setShowConfirmSend(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message || 'Update failed.' : 'Update failed.');
    } finally {
      setSaving(false);
    }
  }

  const dirty = active ? editText !== active.draft_text : false;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">Denial Appeal Draft</h2>
            <p className="text-sm text-slate-500 mt-1">
              AI-drafted appeal letter. Review and edit before sending — nothing is sent automatically.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        {loadingList ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <>
            {drafts.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-4">
                {drafts.map((d, i) => (
                  <button
                    key={d.id}
                    onClick={() => setActiveId(d.id)}
                    className={`text-xs px-3 py-1.5 rounded-full border ${
                      d.id === activeId
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-slate-600 border-slate-300 hover:border-primary-400'
                    }`}
                  >
                    Draft {drafts.length - i} <span className={`badge ${statusStyle[d.status]} ml-1`}>{d.status}</span>
                  </button>
                ))}
              </div>
            )}

            {!active && !loading && (
              <div className="border border-dashed border-slate-300 rounded-lg p-6">
                <p className="text-slate-600 text-sm mb-4">
                  No appeal draft yet for this claim. Optionally add denial details not captured from
                  the ERA, then generate a draft. The AI will base the letter on the clinical note
                  and the denial reason codes.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <div>
                    <label className="label">Reason code (optional)</label>
                    <input
                      className="input"
                      placeholder="e.g. CO-50"
                      value={manualReason.reason_code}
                      onChange={(e) => setManualReason({ ...manualReason, reason_code: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">CPT (optional)</label>
                    <input
                      className="input"
                      placeholder="e.g. 97110"
                      value={manualReason.cpt_code}
                      onChange={(e) => setManualReason({ ...manualReason, cpt_code: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Note (optional)</label>
                    <input
                      className="input"
                      placeholder="e.g. denied as not medically necessary"
                      value={manualReason.description}
                      onChange={(e) => setManualReason({ ...manualReason, description: e.target.value })}
                    />
                  </div>
                </div>
                <button onClick={generateDraft} className="btn-primary" disabled={loading}>
                  Draft appeal letter
                </button>
              </div>
            )}

            {loading && (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-3"></div>
                <p className="text-sm text-slate-500">Reading the note and drafting the appeal...</p>
              </div>
            )}

            {llmMissing && (
              <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-800 mb-4">
                <p className="font-medium mb-1">AI appeal drafting isn't set up for this clinic yet</p>
                <p>
                  AI features are an optional add-on, included free — we charge nothing extra. To
                  enable them, add your clinic's own API key (Anthropic or OpenAI) in Settings → AI:
                  for your security and HIPAA compliance, your patient data goes directly to your AI
                  provider under your Business Associate Agreement, never through our account. Your
                  AI provider bills you separately for usage.
                </p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-700 mb-4">
                {error}
              </div>
            )}

            {active && !loading && (
              <>
                <div className="bg-slate-50 border border-slate-200 rounded p-3 mb-4 text-xs text-slate-600">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      Model: <span className="font-medium">{active.model}</span>
                    </span>
                    <span>
                      Drafted:{' '}
                      {new Date(active.created_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                    {active.author_name && <span>By: {active.author_name}</span>}
                  </div>
                  {active.denial_reasons.length > 0 && (
                    <div className="mt-2">
                      <span className="font-medium">Denial reasons addressed:</span>
                      <ul className="list-disc list-inside mt-1">
                        {active.denial_reasons.map((r, i) => (
                          <li key={i}>
                            [{r.source}] {r.cpt_code ? `CPT ${r.cpt_code} — ` : ''}
                            {r.reason_code || 'no code'}
                            {r.description ? ` — ${r.description}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <label className="label">Appeal letter (editable)</label>
                <textarea
                  className="input font-mono text-sm w-full"
                  rows={18}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  disabled={active.status === 'sent'}
                />

                <div className="flex items-center gap-2 mt-4 flex-wrap">
                  {active.status !== 'sent' && (
                    <>
                      <button
                        onClick={saveEdits}
                        className="btn-secondary"
                        disabled={saving || !dirty}
                      >
                        {saving ? 'Saving...' : 'Save edits'}
                      </button>
                      {!showConfirmSend ? (
                        <button
                          onClick={() => setShowConfirmSend(true)}
                          className="btn-primary"
                          disabled={saving}
                        >
                          Mark as sent
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded px-3 py-1.5 text-sm">
                          Confirm you've sent this appeal?
                          <button
                            onClick={markSent}
                            className="text-xs font-medium text-amber-800 underline"
                            disabled={saving}
                          >
                            Confirm sent
                          </button>
                          <button
                            onClick={() => setShowConfirmSend(false)}
                            className="text-xs text-slate-500 underline"
                          >
                            Back
                          </button>
                        </span>
                      )}
                    </>
                  )}
                  {active.status === 'sent' && (
                    <span className="badge badge-green">Sent — this draft is locked</span>
                  )}
                  <button onClick={generateDraft} className="text-xs text-slate-500 underline ml-auto" disabled={loading}>
                    Generate a fresh draft
                  </button>
                </div>

                <p className="text-xs text-slate-400 mt-4">
                  This is an AI-generated draft. Always review and edit before sending to the payer.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
