import { useState, useEffect } from 'react';
import { api } from '../services/api';

function unwrapList(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

export default function BillingDenialPatterns() {
  const [patterns, setPatterns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [payer, setPayer] = useState('');
  const [minRate, setMinRate] = useState('');
  const [minSamples, setMinSamples] = useState('5');
  const [scope, setScope] = useState('clinic');
  const [contribute, setContribute] = useState(false);
  const [relearning, setRelearning] = useState(false);
  const [confirmRelearn, setConfirmRelearn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { loadPatterns(); }, [scope]);
  useEffect(() => { loadContribute(); }, []);

  async function loadPatterns() {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams();
      if (payer.trim()) params.set('payer', payer.trim());
      if (minRate !== '') params.set('minRate', minRate);
      if (minSamples !== '') params.set('minSamples', minSamples);
      params.set('scope', scope);
      const res = await api.get<any>(`/billing/denial-patterns?${params.toString()}`);
      setPatterns(unwrapList(res));
    } catch {
      setMessage('Could not load denial patterns.');
    } finally {
      setLoading(false);
    }
  }

  async function loadContribute() {
    try {
      const res = await api.get<any>('/billing/denial-patterns/contribute');
      setContribute(!!(res?.data?.enabled ?? res?.enabled));
    } catch { /* optional feature; leave default */ }
  }

  async function toggleContribute() {
    try {
      const res = await api.put<any>('/billing/denial-patterns/contribute', { enabled: !contribute });
      setContribute(!!(res?.data?.enabled ?? !contribute));
    } catch {
      setMessage('Could not update the cross-clinic contribution setting.');
    }
  }

  async function doRelearn() {
    setRelearning(true);
    setMessage(null);
    try {
      const res = await api.post<any>('/billing/denial-patterns/relearn', {});
      const data = res?.data ?? {};
      setMessage(`Relearned from ${data.erasProcessed ?? 0} ERA file(s), ${data.linesProcessed ?? 0} lines processed.`);
      setConfirmRelearn(false);
      loadPatterns();
    } catch {
      setMessage('Relearn failed.');
    } finally {
      setRelearning(false);
    }
  }

  function fmtRate(r: any): string {
    const n = typeof r === 'string' ? parseFloat(r) : r;
    return `${(n * 100).toFixed(1)}%`;
  }

  function fmtDiag(d: string): string {
    return d ? d : 'any';
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="label">Payer</label>
          <input value={payer} onChange={e => setPayer(e.target.value)} placeholder="Filter by payer name" className="input" />
        </div>
        <div>
          <label className="label">Min denial rate</label>
          <select value={minRate} onChange={e => setMinRate(e.target.value)} className="input">
            <option value="">Any</option>
            <option value="0.1">≥ 10%</option>
            <option value="0.25">≥ 25%</option>
            <option value="0.5">≥ 50%</option>
          </select>
        </div>
        <div>
          <label className="label">Min samples</label>
          <input value={minSamples} onChange={e => setMinSamples(e.target.value)} type="number" min="0" className="input w-24" />
        </div>
        <div>
          <label className="label">Scope</label>
          <select value={scope} onChange={e => setScope(e.target.value)} className="input">
            <option value="clinic">This clinic</option>
            <option value="global">Cross-clinic</option>
            <option value="all">All</option>
          </select>
        </div>
        <button onClick={loadPatterns} className="btn-secondary">Apply</button>
        {confirmRelearn ? (
          <span className="inline-flex gap-2 items-center text-sm">
            <span className="text-amber-700">Rebuild all patterns from posted ERAs?</span>
            <button onClick={doRelearn} disabled={relearning} className="btn-primary text-sm disabled:opacity-50">
              {relearning ? 'Relearning...' : 'Confirm'}
            </button>
            <button onClick={() => setConfirmRelearn(false)} className="btn-secondary text-sm">Back</button>
          </span>
        ) : (
          <button onClick={() => setConfirmRelearn(true)} className="btn-secondary">Relearn from ERAs</button>
        )}
      </div>

      {message && <div className="text-sm text-slate-600">{message}</div>}

      <div className="card text-sm text-slate-600">
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={contribute} onChange={toggleContribute} className="mt-1" />
          <span>
            <span className="font-medium text-slate-800">Contribute anonymized patterns to cross-clinic learning</span>
            <span className="block text-xs mt-0.5">
              Opt-in. Only payer, CPT, diagnosis, reason code, counts and rates are ever shared —
              never clinic or patient data. The future aggregation pipeline will only publish
              patterns seen on 50+ lines across 3+ clinics.
            </span>
          </span>
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
      ) : patterns.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">
          No denial patterns learned yet. Patterns are learned automatically each time an ERA posts.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Payer</th>
                <th className="text-left px-4 py-3">CPT</th>
                <th className="text-left px-4 py-3">Diagnosis</th>
                <th className="text-left px-4 py-3">Reason</th>
                <th className="text-right px-4 py-3">Denial rate</th>
                <th className="text-right px-4 py-3">Samples</th>
                <th className="text-left px-4 py-3">Scope</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {patterns.map((p: any) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{p.payer_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.cpt_code}</td>
                  <td className="px-4 py-3 font-mono text-xs">{fmtDiag(p.diagnosis_code)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.reason_code}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {fmtRate(p.denial_rate)}
                    <span className="block text-xs font-normal text-slate-500">
                      {p.denied_lines} of {p.total_lines} lines
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.total_lines}
                    {p.total_lines < 20 && <span className="block text-xs text-amber-600">low confidence</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={p.scope === 'global' ? 'badge-blue text-xs' : 'badge-gray text-xs'}>
                      {p.scope === 'global' ? `cross-clinic (${p.contributing_clinics})` : 'this clinic'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Rates always show sample sizes. Patterns with fewer than 5 samples never influence risk scores;
        fewer than 20 are flagged low-confidence.
      </p>
    </div>
  );
}
