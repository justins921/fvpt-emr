import { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { api } from '../services/api';

export default function BillingPage() {
  const location = useLocation();
  const tabs = [
    { path: '/billing', label: 'Claims' },
    { path: '/billing/aging', label: 'A/R Aging' },
    { path: '/billing/era', label: 'ERA Import' },
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
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{c.claim_number}</td>
                  <td className="px-4 py-3">
                    <Link to={`/patients/${c.patient_id}`} className="text-primary-600 hover:underline">
                      {c.patient_last_name}, {c.patient_first_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{new Date(c.service_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right font-mono">${(c.total_charge_cents / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono">${(c.total_paid_cents / 100).toFixed(2)}</td>
                  <td className="px-4 py-3"><span className={statusColors[c.status] || 'badge-gray'}>{c.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {c.status === 'draft' && <button onClick={() => scrubClaim(c.id)} className="text-xs text-blue-600 underline">Scrub</button>}
                      {c.status === 'scrubbed' && <button onClick={() => exportClaim(c.id)} className="text-xs text-green-600 underline">Export 837P</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

  async function handleImport() {
    if (!content.trim()) return;
    try {
      const res = await api.post<any>('/billing/era/import', { filename: `ERA_${Date.now()}.835`, content });
      setResult(res.data);
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
    </div>
  );
}
