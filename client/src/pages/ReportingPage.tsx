import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

type Tab = 'dashboard' | 'productivity' | 'revenue' | 'visits' | 'payer_mix' | 'cancellations' | 'auth_status';

const TABS: { key: Tab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'productivity', label: 'Productivity' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'visits', label: 'Visits' },
  { key: 'payer_mix', label: 'Payer Mix' },
  { key: 'cancellations', label: 'Cancellations' },
  { key: 'auth_status', label: 'Auth Status' },
];

const fmt$ = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: number | string) => (typeof n === 'string' ? parseFloat(n) : n).toLocaleString('en-US');
const fmtP = (n: number | string) => (typeof n === 'string' ? parseFloat(n) : n).toFixed(1) + '%';

function defRange() {
  const e = new Date(), s = new Date(); s.setDate(s.getDate() - 30);
  return { startDate: s.toISOString().split('T')[0], endDate: e.toISOString().split('T')[0] };
}

function Spin() {
  return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
}

function DateFilters({ sd, ed, setSd, setEd, onRun, children }: { sd: string; ed: string; setSd: (v: string) => void; setEd: (v: string) => void; onRun: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2 items-end">
      <div><label className="label">Start</label><input type="date" value={sd} onChange={e => setSd(e.target.value)} className="input" /></div>
      <div><label className="label">End</label><input type="date" value={ed} onChange={e => setEd(e.target.value)} className="input" /></div>
      {children}
      <button onClick={onRun} className="btn-primary text-sm">Run Report</button>
    </div>
  );
}

export default function ReportingPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('dashboard');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Reports & Analytics</h1>
      <div className="flex gap-1 border-b border-slate-200 pb-1 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${tab === t.key ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >{t.label}</button>
        ))}
      </div>
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'productivity' && <ProductivityTab />}
      {tab === 'revenue' && <RevenueTab />}
      {tab === 'visits' && <VisitsTab />}
      {tab === 'payer_mix' && <PayerMixTab />}
      {tab === 'cancellations' && <CancellationsTab />}
      {tab === 'auth_status' && <AuthStatusTab />}
    </div>
  );
}

function DashboardTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => { try { const r = await api.get<any>('/reporting/dashboard'); setData(r.data); } catch {} finally { setLoading(false); } })();
  }, []);
  if (loading) return <Spin />;
  if (!data) return <div className="text-red-600 text-sm">Failed to load dashboard</div>;
  const kpis = [
    { label: 'Active Patients', value: fmtN(data.active_patients), sub: `${fmtN(data.total_patients)} total`, color: 'text-slate-900' },
    { label: 'Today Appointments', value: fmtN(data.today_appointments), sub: `${data.today_completed} completed`, color: 'text-blue-600' },
    { label: 'No-Shows Today', value: fmtN(data.today_no_shows), color: 'text-red-600' },
    { label: 'Cancellations Today', value: fmtN(data.today_cancellations), color: 'text-orange-600' },
    { label: 'POC Expiring (14d)', value: fmtN(data.upcoming_poc_expirations), color: 'text-yellow-600' },
    { label: 'Pending Auths', value: fmtN(data.pending_authorizations), color: 'text-purple-600' },
    { label: 'Unread Messages', value: fmtN(data.unread_messages), color: 'text-primary-600' },
    { label: 'Overdue Tasks', value: fmtN(data.overdue_tasks), color: 'text-red-600' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {kpis.map(k => (
        <div key={k.label} className="card py-4 text-center">
          <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
          <div className="text-xs text-slate-500 mt-1">{k.label}</div>
          {k.sub && <div className="text-xs text-slate-400">{k.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function ProductivityTab() {
  const dr = defRange();
  const [sd, setSd] = useState(dr.startDate); const [ed, setEd] = useState(dr.endDate);
  const [data, setData] = useState<any[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { const r = await api.get<any>(`/reporting/productivity?startDate=${sd}&endDate=${ed}`); setData(r.data || []); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to load'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-4">
      <DateFilters sd={sd} ed={ed} setSd={setSd} setEd={setEd} onRun={load} />
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {loading ? <Spin /> : data.length === 0 ? <div className="card text-center text-slate-500 py-8">No data for selected range</div> : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b"><tr>
              <th className="text-left px-4 py-3">Therapist</th><th className="text-right px-4 py-3">Patients</th>
              <th className="text-right px-4 py-3">Visits</th><th className="text-right px-4 py-3">Units/Visit</th>
              <th className="text-right px-4 py-3">Avg Tx Time</th><th className="text-right px-4 py-3">Cancel %</th>
              <th className="text-right px-4 py-3">No-Show %</th>
            </tr></thead>
            <tbody className="divide-y">
              {data.map((r: any) => (
                <tr key={r.therapist_id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{r.therapist_last_name}, {r.therapist_first_name}{r.therapist_credential && <span className="text-xs text-slate-400 ml-1">({r.therapist_credential})</span>}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtN(r.patient_count)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtN(r.visit_count)}</td>
                  <td className="px-4 py-3 text-right font-mono">{parseFloat(r.units_per_visit || 0).toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono">{parseFloat(r.average_treatment_time || 0).toFixed(0)} min</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtP(r.cancellation_rate)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtP(r.no_show_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RevenueTab() {
  const dr = defRange();
  const [sd, setSd] = useState(dr.startDate); const [ed, setEd] = useState(dr.endDate);
  const [groupBy, setGroupBy] = useState('month');
  const [data, setData] = useState<any>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { const r = await api.get<any>(`/reporting/revenue?startDate=${sd}&endDate=${ed}&groupBy=${groupBy}`); setData(r.data); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to load'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  const colLabel = groupBy === 'month' ? 'Period' : groupBy === 'provider' ? 'Provider' : groupBy === 'payer' ? 'Payer' : 'CPT Code';
  return (
    <div className="space-y-4">
      <DateFilters sd={sd} ed={ed} setSd={setSd} setEd={setEd} onRun={load}>
        <div><label className="label">Group By</label>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="input">
            <option value="month">Month</option><option value="provider">Provider</option>
            <option value="payer">Payer</option><option value="service">Service (CPT)</option>
          </select></div>
      </DateFilters>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {loading ? <Spin /> : !data ? null : (<>
        {data.totals && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[{ l: 'Total Charges', v: data.totals.total_charges, c: 'text-slate-900' }, { l: 'Total Payments', v: data.totals.total_payments, c: 'text-green-600' },
              { l: 'Adjustments', v: data.totals.total_adjustments, c: 'text-orange-600' }, { l: 'Net Revenue', v: data.totals.net_revenue, c: 'text-primary-600' }].map(k => (
              <div key={k.l} className="card py-3 text-center"><div className={`text-xl font-bold ${k.c}`}>{fmt$(k.v)}</div><div className="text-xs text-slate-500">{k.l}</div></div>
            ))}
          </div>
        )}
        {data.breakdown?.length > 0 && (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b"><tr>
                <th className="text-left px-4 py-3">{colLabel}</th><th className="text-right px-4 py-3">Charges</th>
                <th className="text-right px-4 py-3">Payments</th><th className="text-right px-4 py-3">Adjustments</th>
                <th className="text-right px-4 py-3">Net Revenue</th>
              </tr></thead>
              <tbody className="divide-y">
                {data.breakdown.map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{r.group_label}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt$(r.total_charges)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt$(r.total_payments)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt$(r.total_adjustments)}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium">{fmt$(r.net_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>)}
    </div>
  );
}

function VisitsTab() {
  const dr = defRange();
  const [sd, setSd] = useState(dr.startDate); const [ed, setEd] = useState(dr.endDate);
  const [data, setData] = useState<any>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { const r = await api.get<any>(`/reporting/visit-stats?startDate=${sd}&endDate=${ed}`); setData(r.data); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to load'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-4">
      <DateFilters sd={sd} ed={ed} setSd={setSd} setEd={setEd} onRun={load} />
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {loading ? <Spin /> : !data ? null : (<>
        <div className="card py-3 text-center">
          <div className="text-2xl font-bold text-primary-600">{data.average_visits_per_patient}</div>
          <div className="text-xs text-slate-500">Avg Visits per Patient</div>
        </div>
        {data.visit_type_breakdown?.length > 0 && (
          <div className="card">
            <h3 className="font-semibold text-sm mb-3">Visit Type Breakdown</h3>
            <div className="space-y-2">
              {data.visit_type_breakdown.map((row: any, i: number) => {
                const tot = data.visit_type_breakdown.reduce((s: number, r: any) => s + parseInt(r.count), 0);
                const pct = tot > 0 ? (parseInt(row.count) / tot * 100) : 0;
                return (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-32 text-slate-600 capitalize">{(row.appointment_type || 'Unknown').replace('_', ' ')}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                      <div className="bg-primary-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-mono w-16 text-right">{fmtN(row.count)}</span>
                  </div>);
              })}
            </div>
          </div>
        )}
        {data.new_patients_per_period?.length > 0 && (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b"><tr><th className="text-left px-4 py-3">Period</th><th className="text-right px-4 py-3">New Patients</th></tr></thead>
              <tbody className="divide-y">
                {data.new_patients_per_period.map((r: any) => (
                  <tr key={r.period} className="hover:bg-slate-50"><td className="px-4 py-3">{r.period}</td><td className="px-4 py-3 text-right font-mono">{fmtN(r.new_patients)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>)}
    </div>
  );
}

function PayerMixTab() {
  const [data, setData] = useState<any[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    (async () => { try { const r = await api.get<any>('/reporting/payer-mix'); setData(r.data || []); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } finally { setLoading(false); } })();
  }, []);
  if (loading) return <Spin />;
  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  return data.length === 0 ? <div className="card text-center text-slate-500 py-8">No payer data available</div> : (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b"><tr>
          <th className="text-left px-4 py-3">Payer</th><th className="text-right px-4 py-3">Patients</th>
          <th className="text-right px-4 py-3">Claims</th><th className="text-right px-4 py-3">Charges</th>
          <th className="text-right px-4 py-3">Paid</th><th className="text-right px-4 py-3">Reimb %</th>
          <th className="text-right px-4 py-3">Denial %</th>
        </tr></thead>
        <tbody className="divide-y">
          {data.map((r: any, i: number) => (
            <tr key={i} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium">{r.payer_name}</td>
              <td className="px-4 py-3 text-right font-mono">{fmtN(r.patient_count)}</td>
              <td className="px-4 py-3 text-right font-mono">{fmtN(r.claim_count)}</td>
              <td className="px-4 py-3 text-right font-mono">{fmt$(r.total_charges)}</td>
              <td className="px-4 py-3 text-right font-mono">{fmt$(r.total_paid)}</td>
              <td className="px-4 py-3 text-right font-mono">{fmtP(r.average_reimbursement_rate)}</td>
              <td className="px-4 py-3 text-right font-mono">{fmtP(r.denial_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CancellationsTab() {
  const dr = defRange();
  const [sd, setSd] = useState(dr.startDate); const [ed, setEd] = useState(dr.endDate);
  const [data, setData] = useState<any>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { const r = await api.get<any>(`/reporting/cancellation-no-show?startDate=${sd}&endDate=${ed}`); setData(r.data); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-4">
      <DateFilters sd={sd} ed={ed} setSd={setSd} setEd={setEd} onRun={load} />
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {loading ? <Spin /> : !data ? null : (<>
        {data.totals && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[{ l: 'Total Scheduled', v: fmtN(data.totals.total_scheduled), c: '' }, { l: 'Cancelled', v: fmtN(data.totals.cancelled), c: 'text-orange-600' },
              { l: 'No-Shows', v: fmtN(data.totals.no_show), c: 'text-red-600' }, { l: 'Cancel Rate', v: fmtP(data.totals.cancellation_rate), c: 'text-orange-600' },
              { l: 'No-Show Rate', v: fmtP(data.totals.no_show_rate), c: 'text-red-600' }].map(k => (
              <div key={k.l} className="card py-3 text-center"><div className={`text-xl font-bold ${k.c}`}>{k.v}</div><div className="text-xs text-slate-500">{k.l}</div></div>
            ))}
          </div>
        )}
        {data.by_period?.length > 0 && (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b"><tr>
                <th className="text-left px-4 py-3">Period</th><th className="text-right px-4 py-3">Scheduled</th>
                <th className="text-right px-4 py-3">Cancelled</th><th className="text-right px-4 py-3">No-Show</th>
                <th className="text-right px-4 py-3">Cancel %</th><th className="text-right px-4 py-3">No-Show %</th>
              </tr></thead>
              <tbody className="divide-y">
                {data.by_period.map((r: any) => (
                  <tr key={r.period} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{r.period}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtN(r.total_scheduled)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtN(r.cancelled)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtN(r.no_show)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtP(r.cancellation_rate)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtP(r.no_show_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>)}
    </div>
  );
}

function AuthStatusTab() {
  const [data, setData] = useState<any>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    (async () => { try { const r = await api.get<any>('/reporting/authorization-status'); setData(r.data); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } finally { setLoading(false); } })();
  }, []);
  if (loading) return <Spin />;
  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!data) return null;

  function AuthTable({ rows, columns }: { rows: any[]; columns: { key: string; label: string; align?: string; bold?: boolean; color?: string }[] }) {
    return rows.length === 0 ? null : (
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b"><tr>
            {columns.map(c => <th key={c.key} className={`${c.align === 'right' ? 'text-right' : 'text-left'} px-4 py-3`}>{c.label}</th>)}
          </tr></thead>
          <tbody className="divide-y">
            {rows.map((r: any) => (
              <tr key={r.id} className="hover:bg-slate-50">
                {columns.map(c => (
                  <td key={c.key} className={`px-4 py-3 ${c.align === 'right' ? 'text-right' : ''} ${c.bold ? 'font-bold' : ''} ${c.color || ''} ${c.key === 'authorization_number' ? 'font-mono text-xs' : ''}`}>
                    {c.key === 'patient' ? `${r.patient_last_name}, ${r.patient_first_name}` : c.key === 'end_date' ? new Date(r.end_date).toLocaleDateString() : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="card py-3 text-center"><div className="text-2xl font-bold text-green-600">{fmtN(data.total_active)}</div><div className="text-xs text-slate-500">Active Authorizations</div></div>
        <div className="card py-3 text-center"><div className="text-2xl font-bold text-red-600">{fmtN(data.total_expired)}</div><div className="text-xs text-slate-500">Expired Authorizations</div></div>
      </div>
      <h3 className="font-semibold text-sm">Expiring Within 30 Days ({data.expiring_soon?.length || 0})</h3>
      {data.expiring_soon?.length > 0 ? (
        <AuthTable rows={data.expiring_soon} columns={[
          { key: 'patient', label: 'Patient' }, { key: 'authorization_number', label: 'Auth #' },
          { key: 'authorized_visits', label: 'Authorized', align: 'right' }, { key: 'used_visits', label: 'Used', align: 'right' },
          { key: 'end_date', label: 'End Date', color: 'text-red-600' },
        ]} />
      ) : <div className="card text-center text-slate-500 py-4 text-sm">No authorizations expiring soon</div>}
      <h3 className="font-semibold text-sm">Low Visits Remaining (&lt;3) ({data.visits_remaining_low?.length || 0})</h3>
      {data.visits_remaining_low?.length > 0 ? (
        <AuthTable rows={data.visits_remaining_low} columns={[
          { key: 'patient', label: 'Patient' }, { key: 'authorization_number', label: 'Auth #' },
          { key: 'authorized_visits', label: 'Authorized', align: 'right' }, { key: 'used_visits', label: 'Used', align: 'right' },
          { key: 'visits_remaining', label: 'Remaining', align: 'right', bold: true, color: 'text-red-600' },
        ]} />
      ) : <div className="card text-center text-slate-500 py-4 text-sm">No authorizations with low visits remaining</div>}
    </div>
  );
}
