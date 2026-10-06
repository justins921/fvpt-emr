import { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { api } from '../services/api';
import CodeReviewPanel from '../components/CodeReviewPanel';
import AppealDraftPanel from '../components/AppealDraftPanel';
import { UnderpaymentsQueue, FeeSchedules } from './BillingUnderpayment';
import BillingDenialPatterns from './BillingDenialPatterns';

export default function BillingPage() {
  const location = useLocation();
  const tabs = [
    { path: '/app/billing', label: 'Claims' },
    { path: '/app/billing/underpayments', label: 'Underpayments' },
    { path: '/app/billing/fee-schedules', label: 'Fee Schedules' },
    { path: '/app/billing/denial-patterns', label: 'Denial Patterns' },
    { path: '/app/billing/aging', label: 'A/R Aging' },
    { path: '/app/billing/era', label: 'ERA Import' },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Billing</h1>
      <div className="flex gap-1 border-b border-slate-200 pb-1">
        {tabs.map(tab => (
          <Link
            key={tab.path}
            to={tab.path}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg ${location.pathname === tab.path ? 'bg-white border border-b-white border-slate-200 -mb-px' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <Routes>
        <Route index element={<ClaimsList />} />
        <Route path="underpayments" element={<UnderpaymentsQueue />} />
        <Route path="fee-schedules" element={<FeeSchedules />} />
        <Route path="denial-patterns" element={<BillingDenialPatterns />} />
        <Route path="aging" element={<ARAgingReport />} />
        <Route path="era" element={<ERAImport />} />
      </Routes>
    </div>
  );
}

function ClaimsList() {
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [reviewClaimId, setReviewClaimId] = useState<string | null>(null);
  const [appealClaimId, setAppealClaimId] = useState<string | null>(null);
  const [riskById, setRiskById] = useState<Record<string, any>>({});
  const [riskLoading, setRiskLoading] = useState<string | null>(null);
  const [expandedRisk, setExpandedRisk] = useState<string | null>(null);

  useEffect(() => { loadClaims(); }, [filter]);

  async function loadClaims() {
    setLoading(true);
    try {
      const res = await api.get<any>(`/billing/claims?limit=50${filter ? `&status=${filter}` : ''}`);
      setClaims(res.data || []);
    } catch {} finally { setLoading(false); }
  }

  async function scrubClaim(id: string) {
    try {
      const res = await api.post<any>(`/billing/claims/${id}/scrub`);
      if (res.data?.errors?.length) {
        alert('Scrub errors:\n' + res.data.errors.join('\n'));
      }
      loadClaims();
    } catch {}
  }

  async function checkRisk(id: string) {
    if (riskById[id]) {
      setExpandedRisk(expandedRisk === id ? null : id);
      return;
    }
    setRiskLoading(id);
    try {
      const res = await api.get<any>(`/billing/claims/${id}/denial-risk`);
      const risk = res?.data ?? res;
      setRiskById(prev => ({ ...prev, [id]: risk }));
      setExpandedRisk(id);
    } catch {
      // Leave badge unshown on error; risk scoring is advisory.
    } finally {
      setRiskLoading(null);
    }
  }

  function riskBadge(risk: any) {
    if (!risk) return null;
    const cls = risk.band === 'high' ? 'badge-red' : risk.band === 'medium' ? 'badge-yellow' : 'badge-green';
    return <span className={`${cls} text-xs`}>Risk {risk.band}: {risk.score}</span>;
  }

  async function exportClaim(id: string) {
    try {
      const res = await api.get<string>(`/billing/claims/${id}/837p`);
      const blob = new Blob([res as any], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `837P_${id}.edi`; a.click();
      URL.revokeObjectURL(url);
    } catch {}
  }

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

  const statusColors: Record<string, string> = {
    draft: 'badge-gray', scrubbed: 'badge-blue', scrub_failed: 'badge-red',
    submitted: 'badge-yellow', accepted: 'badge-green', rejected: 'badge-red',
    paid: 'badge-green', partially_paid: 'badge-yellow', denied: 'badge-red',
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <select value={filter} onChange={e => setFilter(e.target.value)} className="input max-w-xs">
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="scrubbed">Scrubbed</option>
          <option value="scrub_failed">Scrub Failed</option>
          <option value="submitted">Submitted</option>
          <option value="paid">Paid</option>
          <option value="denied">Denied</option>
        </select>
      </div>
      {claims.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No claims found</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Claim #</th>
                <th className="text-left px-4 py-3">Patient</th>
                <th className="text-left px-4 py-3">Service Date</th>
                <th className="text-right px-4 py-3">Charges</th>
                <th className="text-right px-4 py-3">Paid</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {claims.map((c: any) => (
                <>
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{c.claim_number}</td>
                  <td className="px-4 py-3">
                    <Link to={`/app/patients/${c.patient_id}`} className="text-primary-600 hover:underline">
                      {c.patient_last_name}, {c.patient_first_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{new Date(c.service_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right font-mono">${(c.total_charge_cents / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono">${(c.total_paid_cents / 100).toFixed(2)}</td>
                  <td className="px-4 py-3"><span className={statusColors[c.status] || 'badge-gray'}>{c.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 items-center">
                      {c.status === 'draft' && <button onClick={() => scrubClaim(c.id)} className="text-xs text-blue-600 underline">Scrub</button>}
                      {c.status === 'scrubbed' && <button onClick={() => exportClaim(c.id)} className="text-xs text-green-600 underline">Export 837P</button>}
                      {(c.status === 'draft' || c.status === 'scrubbed' || c.status === 'scrub_failed') && (
                        <button onClick={() => setReviewClaimId(c.id)} className="text-xs text-purple-600 underline">Review codes</button>
                      )}
                      {(c.status === 'denied' || c.status === 'rejected') && (
                        <button onClick={() => setAppealClaimId(c.id)} className="text-xs text-orange-600 underline">Draft appeal</button>
                      )}
                      <button
                        onClick={() => checkRisk(c.id)}
                        disabled={riskLoading === c.id}
                        className="text-xs text-purple-600 underline disabled:opacity-50"
                      >
                        {riskLoading === c.id ? 'Checking...' : 'Risk'}
                      </button>
                      {riskById[c.id] && riskBadge(riskById[c.id])}
                    </div>
                  </td>
                </tr>
                {expandedRisk === c.id && riskById[c.id] && (
                  <tr key={`${c.id}-risk`}>
                    <td colSpan={7} className="px-4 py-3 bg-purple-50">
                      <RiskDetail risk={riskById[c.id]} />
                    </td>
                  </tr>
                )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reviewClaimId && (
        <CodeReviewPanel claimId={reviewClaimId} onClose={() => setReviewClaimId(null)} />
      )}
      {appealClaimId && (
        <AppealDraftPanel claimId={appealClaimId} onClose={() => setAppealClaimId(null)} />
      )}
    </div>
  );
}

function RiskDetail({ risk }: { risk: any }) {
  if (!risk || !risk.lines || risk.lines.length === 0) {
    return (
      <div className="text-sm text-slate-600">
        No denial patterns match this claim yet — not enough history to score risk.
        Patterns are learned automatically each time an ERA posts.
      </div>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      <div className="font-medium">
        Denial risk: {risk.score}/100 ({risk.band})
      </div>
      {risk.lines.map((line: any, i: number) => (
        <div key={i} className="border-l-2 border-purple-200 pl-3">
          <div className="font-mono text-xs">
            {line.cptCode}{line.diagnosisCode ? ` · ${line.diagnosisCode}` : ''} — risk {line.risk}
            {line.level && <span className="text-slate-500"> ({line.level})</span>}
          </div>
          {line.topPatterns && line.topPatterns.length > 0 ? (
            <ul className="list-disc list-inside text-slate-600 text-xs mt-1 space-y-0.5">
              {line.topPatterns.map((p: any, j: number) => (
                <li key={j}>{p.text}</li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-slate-500">No matching patterns for this line.</div>
          )}
        </div>
      ))}
    </div>
  );
}

function ARAgingReport() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<any>('/billing/reports/ar-aging');
        setReport(res.data);
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  if (!report) return <div className="text-slate-500">Failed to load report</div>;

  const bucketLabels = [
    { key: 'current', label: '0-30 Days', color: 'bg-green-100' },
    { key: 'days30', label: '31-60 Days', color: 'bg-yellow-100' },
    { key: 'days60', label: '61-90 Days', color: 'bg-orange-100' },
    { key: 'days90', label: '91-120 Days', color: 'bg-red-100' },
    { key: 'days120plus', label: '120+ Days', color: 'bg-red-200' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {bucketLabels.map(b => {
          const items = report.buckets[b.key] || [];
          const total = items.reduce((s: number, i: any) => s + (i.balance_cents || 0), 0);
          return (
            <div key={b.key} className={`card ${b.color}`}>
              <div className="text-xs text-slate-600">{b.label}</div>
              <div className="text-xl font-bold mt-1">${(total / 100).toFixed(2)}</div>
              <div className="text-xs text-slate-500">{items.length} claims</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ERAImport() {
  const [content, setContent] = useState('');
  const [result, setResult] = useState<any>(null);
  const [exceptions, setExceptions] = useState<any>(null);
  const [excLoading, setExcLoading] = useState(false);

  async function handleImport() {
    if (!content.trim()) return;
    try {
      const res = await api.post<any>('/billing/era/import', { filename: `ERA_${Date.now()}.835`, content });
      setResult(res.data);
      setExceptions(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed');
    }
  }

  async function handlePost() {
    if (!result?.id) return;
    try {
      const res = await api.post<any>(`/billing/era/${result.id}/post`);
      alert(`Posted ${res.data?.posted || 0} claims. Errors: ${res.data?.errors?.join(', ') || 'none'}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Post failed');
    }
  }

  async function viewExceptions() {
    if (!result?.id) return;
    setExcLoading(true);
    try {
      const res = await api.get<any>(`/billing/era/${result.id}/exceptions`);
      const d = res?.data && typeof res.data === 'object' ? res.data : res;
      setExceptions(d);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to load exceptions');
    } finally {
      setExcLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="font-semibold mb-3">Import ERA (835) File</h3>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={10}
          className="input font-mono text-xs"
          placeholder="Paste 835 ERA content here..."
        />
        <div className="mt-3 flex gap-2">
          <button onClick={handleImport} className="btn-primary">Import ERA</button>
          {result && <button onClick={handlePost} className="btn-secondary">Post to Ledger</button>}
          {result?.id && (
            <button onClick={viewExceptions} disabled={excLoading} className="btn-secondary disabled:opacity-50">
              {excLoading ? 'Loading...' : 'View Exceptions'}
            </button>
          )}
        </div>
      </div>
      {result?.parsed && (
        <div className="card">
          <h3 className="font-semibold mb-2">Parsed ERA</h3>
          <div className="text-sm space-y-1">
            <div>Check #: {result.parsed.checkNumber}</div>
            <div>Payer: {result.parsed.payerName}</div>
            <div>Total Paid: ${(result.parsed.totalPaid / 100).toFixed(2)}</div>
            <div>Claims: {result.parsed.claims?.length || 0}</div>
          </div>
        </div>
      )}
      {exceptions && (
        <div className="card">
          <h3 className="font-semibold mb-2">ERA Posting Exceptions</h3>
          <div className="mb-3">
            <span className="badge-green text-sm">✓ {exceptions.autoPostable?.length || 0} auto-postable</span>
            <span className="ml-2 badge-yellow text-sm">⚠ {exceptions.exceptions?.length || 0} exceptions</span>
          </div>
          {exceptions.exceptions?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2">Claim</th>
                    <th className="text-left px-4 py-2">CPT</th>
                    <th className="text-right px-4 py-2">Billed</th>
                    <th className="text-right px-4 py-2">Paid</th>
                    <th className="text-left px-4 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {exceptions.exceptions.map((e: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-xs">{e.claim_number || e.claim || e.claimNumber || '-'}</td>
                      <td className="px-4 py-2 font-mono text-xs">{e.cpt || e.cpt_code || e.cptCode || '-'}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {e.billed_cents != null ? `$${(e.billed_cents / 100).toFixed(2)}` : e.billed != null ? `$${Number(e.billed).toFixed(2)}` : '-'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {e.paid_cents != null ? `$${(e.paid_cents / 100).toFixed(2)}` : e.paid != null ? `$${Number(e.paid).toFixed(2)}` : '-'}
                      </td>
                      <td className="px-4 py-2 text-xs text-amber-700">{e.reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-slate-500">No exceptions — all items auto-postable.</div>
          )}
        </div>
      )}
    </div>
  );
}
