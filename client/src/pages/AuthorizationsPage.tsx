import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const Spinner = () => (
  <div className="flex justify-center py-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
  </div>
);

const EMPTY_AUTH = {
  patient_id: '', insurance_name: '', auth_number: '', service_type: 'PT',
  visits_authorized: '', visits_used: '0', start_date: '', end_date: '', status: 'active', notes: '',
};

function urgencyColor(auth: any): string {
  const remaining = (auth.visits_authorized || 0) - (auth.visits_used || 0);
  const daysLeft = auth.end_date ? Math.ceil((new Date(auth.end_date).getTime() - Date.now()) / 86400000) : 999;
  if (auth.status === 'expired' || auth.status === 'denied') return 'border-l-4 border-l-red-500';
  if (remaining <= 2 || daysLeft <= 7) return 'border-l-4 border-l-red-400';
  if (remaining <= 5 || daysLeft <= 14) return 'border-l-4 border-l-yellow-400';
  return '';
}

export default function AuthorizationsPage() {
  const { user } = useAuth();
  const [auths, setAuths] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_AUTH });
  const [patients, setPatients] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { loadAuths(); loadPatients(); }, [statusFilter]);

  async function loadAuths() {
    setLoading(true);
    try {
      const res = await api.get<any>(`/authorizations?limit=200${statusFilter ? `&status=${statusFilter}` : ''}`);
      setAuths(res.data || []);
    } catch { setError('Failed to load authorizations'); } finally { setLoading(false); }
  }

  async function loadPatients() {
    try { const res = await api.get<any>('/patients?limit=500'); setPatients(res.data || []); } catch {}
  }

  function openCreate() {
    setEditing(null); setForm({ ...EMPTY_AUTH }); setShowForm(true); setError(''); setSuccess('');
  }

  function openEdit(a: any) {
    setEditing(a);
    setForm({
      patient_id: a.patient_id || '', insurance_name: a.insurance_name || '',
      auth_number: a.auth_number || '', service_type: a.service_type || 'PT',
      visits_authorized: String(a.visits_authorized || ''), visits_used: String(a.visits_used || 0),
      start_date: a.start_date?.substring(0, 10) || '', end_date: a.end_date?.substring(0, 10) || '',
      status: a.status || 'active', notes: a.notes || '',
    });
    setShowForm(true); setError(''); setSuccess('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    const payload = { ...form, visits_authorized: Number(form.visits_authorized), visits_used: Number(form.visits_used) };
    try {
      if (editing) { await api.put(`/authorizations/${editing.id}`, payload); setSuccess('Authorization updated'); }
      else { await api.post('/authorizations', payload); setSuccess('Authorization created'); }
      setShowForm(false); loadAuths();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Save failed'); }
  }

  const set = (field: string, val: string) => setForm(f => ({ ...f, [field]: val }));

  // Compute alerts
  const alerts = auths.filter(a => {
    if (a.status !== 'active') return false;
    const remaining = (a.visits_authorized || 0) - (a.visits_used || 0);
    const daysLeft = a.end_date ? Math.ceil((new Date(a.end_date).getTime() - Date.now()) / 86400000) : 999;
    return remaining <= 3 || daysLeft <= 14;
  });

  const STATUS_BADGE: Record<string, string> = {
    active: 'badge-green', pending: 'badge-yellow', expired: 'badge-red', denied: 'badge-red', closed: 'badge-gray',
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Authorization Tracking</h1>
        <button onClick={openCreate} className="btn-primary text-sm">+ New Authorization</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">{success}</div>}

      {alerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4">
          <h3 className="font-semibold text-amber-800 mb-2">Alerts ({alerts.length})</h3>
          <div className="space-y-1">
            {alerts.map((a: any) => {
              const remaining = (a.visits_authorized || 0) - (a.visits_used || 0);
              const daysLeft = a.end_date ? Math.ceil((new Date(a.end_date).getTime() - Date.now()) / 86400000) : null;
              return (
                <div key={a.id} className="text-sm flex justify-between items-center">
                  <span>
                    <span className="font-medium">{a.patient_last_name}, {a.patient_first_name}</span>
                    <span className="text-slate-500 ml-2">({a.insurance_name})</span>
                  </span>
                  <span className="flex gap-3">
                    {remaining <= 3 && <span className="text-red-600 font-medium">{remaining} visits left</span>}
                    {daysLeft !== null && daysLeft <= 14 && <span className="text-amber-700 font-medium">Expires in {daysLeft}d</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <h3 className="sm:col-span-2 lg:col-span-3 font-semibold">{editing ? 'Edit Authorization' : 'New Authorization'}</h3>
          <div>
            <label className="label">Patient *</label>
            <select value={form.patient_id} onChange={e => set('patient_id', e.target.value)} required className="input">
              <option value="">Select patient...</option>
              {patients.map((p: any) => <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}</option>)}
            </select>
          </div>
          <div><label className="label">Insurance *</label><input value={form.insurance_name} onChange={e => set('insurance_name', e.target.value)} required className="input" /></div>
          <div><label className="label">Auth Number</label><input value={form.auth_number} onChange={e => set('auth_number', e.target.value)} className="input" /></div>
          <div>
            <label className="label">Service Type</label>
            <select value={form.service_type} onChange={e => set('service_type', e.target.value)} className="input">
              <option value="PT">Physical Therapy</option><option value="OT">Occupational Therapy</option>
              <option value="SLP">Speech Therapy</option>
            </select>
          </div>
          <div><label className="label">Visits Authorized *</label><input type="number" min="1" value={form.visits_authorized} onChange={e => set('visits_authorized', e.target.value)} required className="input" /></div>
          <div><label className="label">Visits Used</label><input type="number" min="0" value={form.visits_used} onChange={e => set('visits_used', e.target.value)} className="input" /></div>
          <div><label className="label">Start Date *</label><input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} required className="input" /></div>
          <div><label className="label">End Date *</label><input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} required className="input" /></div>
          <div>
            <label className="label">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)} className="input">
              <option value="active">Active</option><option value="pending">Pending</option>
              <option value="expired">Expired</option><option value="denied">Denied</option><option value="closed">Closed</option>
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="label">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="input" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? 'Update' : 'Create'}</button>
          </div>
        </form>
      )}

      <div className="flex gap-2">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input max-w-xs">
          <option value="">All Statuses</option>
          <option value="active">Active</option><option value="pending">Pending</option>
          <option value="expired">Expired</option><option value="denied">Denied</option><option value="closed">Closed</option>
        </select>
      </div>

      {loading ? <Spinner /> : auths.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No authorizations found</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Patient</th>
                <th className="text-left px-4 py-3">Insurance</th>
                <th className="text-left px-4 py-3">Visits</th>
                <th className="text-left px-4 py-3">Expires</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {auths.map((a: any) => {
                const used = a.visits_used || 0;
                const total = a.visits_authorized || 1;
                const pct = Math.min((used / total) * 100, 100);
                return (
                  <tr key={a.id} className={`hover:bg-slate-50 ${urgencyColor(a)}`}>
                    <td className="px-4 py-3 font-medium">{a.patient_last_name}, {a.patient_first_name}</td>
                    <td className="px-4 py-3">{a.insurance_name}</td>
                    <td className="px-4 py-3 w-48">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-200 rounded-full h-2">
                          <div className={`h-2 rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-mono whitespace-nowrap">{used}/{total}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{a.end_date ? new Date(a.end_date).toLocaleDateString() : '-'}</td>
                    <td className="px-4 py-3"><span className={STATUS_BADGE[a.status] || 'badge-gray'}>{a.status}</span></td>
                    <td className="px-4 py-3">
                      <button onClick={() => openEdit(a)} className="text-xs text-primary-600 underline">Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
