import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';

function unwrap(res: any) {
  if (!res) return {};
  return res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : res;
}

interface LineResult {
  cpt_code: string;
  line_number: number | null;
  units: number | null;
  verdict: 'supported' | 'questionable' | 'unsupported';
  confidence: 'high' | 'medium' | 'low' | null;
  justification: string | null;
  quotes: string[];
}

interface UnbilledSuggestion {
  cpt_code: string;
  confidence: 'high' | 'medium' | 'low';
  justification: string;
  quotes: string[];
}

interface ReviewData {
  provider: string;
  model: string;
  reviewed_at: string;
  line_results: LineResult[];
  unbilled_suggestions: UnbilledSuggestion[];
  summary: { supported: number; questionable: number; unsupported: number; unbilled: number };
}

const verdictStyle: Record<string, string> = {
  supported: 'badge-green',
  questionable: 'badge-yellow',
  unsupported: 'badge-red',
};

const verdictLabel: Record<string, string> = {
  supported: 'Supported',
  questionable: 'Questionable',
  unsupported: 'Unsupported',
};

export default function CodeReviewPanel({ claimId, onClose }: { claimId: string; onClose: () => void }) {
  const [review, setReview] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [llmMissing, setLlmMissing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<any>(`/billing/claims/${claimId}/code-review`);
        setReview(unwrap(res));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // No review yet — that's fine, user can run one.
        } else {
          setError('Could not load prior review.');
        }
      } finally {
        setLoadingExisting(false);
      }
    })();
  }, [claimId]);

  async function runReview() {
    setLoading(true);
    setError(null);
    setLlmMissing(false);
    try {
      const res = await api.post<any>(`/billing/claims/${claimId}/code-review`);
      setReview(unwrap(res));
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setLlmMissing(true);
      } else if (err instanceof ApiError) {
        setError(err.message || 'Review failed.');
      } else {
        setError('Review failed.');
      }
    } finally {
      setLoading(false);
    }
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">Documentation-to-Code Review</h2>
            <p className="text-sm text-slate-500 mt-1">
              Compares the claim's CPT codes against what the clinical note documents.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        {loadingExisting ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <>
            {!review && !loading && (
              <div className="text-center py-6">
                <p className="text-slate-500 text-sm mb-4">
                  No review yet for this claim. The AI will read the linked clinical note and check
                  each billed code against the documentation.
                </p>
                <button onClick={runReview} className="btn-primary">
                  Review codes against note
                </button>
              </div>
            )}

            {loading && (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-3"></div>
                <p className="text-sm text-slate-500">Reading note and analyzing codes...</p>
              </div>
            )}

            {llmMissing && (
              <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-800">
                <p className="font-medium mb-1">AI code review isn't set up for this clinic yet</p>
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

            {review && (
              <div className="space-y-6">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="badge-green">{review.summary.supported} supported</span>
                  <span className="badge-yellow">{review.summary.questionable} questionable</span>
                  <span className="badge-red">{review.summary.unsupported} unsupported</span>
                  <span className="badge-blue">{review.summary.unbilled} potentially unbilled</span>
                  <span className="text-slate-400 ml-auto">
                    {review.model} &middot; {new Date(review.reviewed_at).toLocaleString()}
                  </span>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Claimed codes</h3>
                  {review.line_results.length === 0 && (
                    <p className="text-sm text-slate-500">No line items on this claim.</p>
                  )}
                  <div className="space-y-2">
                    {review.line_results.map((line, i) => {
                      const key = `line-${i}`;
                      const isOpen = expanded.has(key);
                      return (
                        <div key={key} className="border border-slate-200 rounded">
                          <button
                            onClick={() => toggle(key)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                          >
                            <span className="font-mono font-medium">{line.cpt_code}</span>
                            {line.units != null && (
                              <span className="text-xs text-slate-500">{line.units} unit{line.units === 1 ? '' : 's'}</span>
                            )}
                            <span className={`badge ${verdictStyle[line.verdict]}`}>{verdictLabel[line.verdict]}</span>
                            <span className="ml-auto text-slate-400 text-sm">{isOpen ? '▾' : '▸'}</span>
                          </button>
                          {isOpen && (
                            <div className="px-4 pb-4 text-sm space-y-2 border-t border-slate-100 pt-3">
                              {line.justification && <p className="text-slate-700">{line.justification}</p>}
                              {line.quotes.length > 0 && (
                                <div>
                                  <p className="text-xs font-medium text-slate-500 mb-1">From the note:</p>
                                  {line.quotes.map((q, qi) => (
                                    <blockquote key={qi} className="border-l-2 border-slate-300 pl-3 py-1 text-slate-600 italic text-[13px]">
                                      &ldquo;{q}&rdquo;
                                    </blockquote>
                                  ))}
                                </div>
                              )}
                              {line.verdict === 'unsupported' && (
                                <p className="text-xs text-red-600 font-medium">
                                  Audit risk: this code was billed without clear documentation support.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {review.unbilled_suggestions.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-2">Potentially unbilled</h3>
                    <p className="text-xs text-slate-500 mb-2">
                      Codes the documentation appears to support but are not on the claim — possible lost revenue.
                    </p>
                    <div className="space-y-2">
                      {review.unbilled_suggestions.map((s, i) => {
                        const key = `unbilled-${i}`;
                        const isOpen = expanded.has(key);
                        return (
                          <div key={key} className="border border-blue-200 bg-blue-50/50 rounded">
                            <button
                              onClick={() => toggle(key)}
                              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-blue-50"
                            >
                              <span className="font-mono font-medium">{s.cpt_code}</span>
                              <span className="badge badge-blue">{s.confidence} confidence</span>
                              <span className="ml-auto text-slate-400 text-sm">{isOpen ? '▾' : '▸'}</span>
                            </button>
                            {isOpen && (
                              <div className="px-4 pb-4 text-sm space-y-2 border-t border-blue-100 pt-3">
                                <p className="text-slate-700">{s.justification}</p>
                                {s.quotes.length > 0 && (
                                  <div>
                                    <p className="text-xs font-medium text-slate-500 mb-1">From the note:</p>
                                    {s.quotes.map((q, qi) => (
                                      <blockquote key={qi} className="border-l-2 border-blue-300 pl-3 py-1 text-slate-600 italic text-[13px]">
                                        &ldquo;{q}&rdquo;
                                      </blockquote>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <p className="text-xs text-slate-500 max-w-md">
                    Assistive only — the AI suggests, the therapist decides. Always verify codes
                    against the full note before changing a claim.
                  </p>
                  <button onClick={runReview} disabled={loading} className="btn-secondary text-sm">
                    Re-run review
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
