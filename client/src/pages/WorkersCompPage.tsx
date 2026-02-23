import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const STATUS_BADGE: Record<string, string> = {
  open: 'badge-blue', closed: 'badge-gray', denied: 'badge-red', settled: 'badge-green',
};

const EMPTY_CASE = {
  patient_id: '', employer_name: '', employer_phone: '', employer_contact: '',
  injury_date: '', claim_number: '', adjuster_name: '', adjuster_phone: '',
  insurance_carrier: '', status: 'open', notes: '',
};

export default function WorkersCompPage() {
  const { user } = useAuth();
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_CASE });
  const [patients, setPatients] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { loadCases(); loadPatients(); }, [statusFilter]);

  async function loadCases() {
    setLoading(true);
    try {
      const res = await api.get<any>(`/workers-comp?limit=100${statusFilter ? `&status=${statusFilter}` : ''}`);
      setCases(res.data || []);
    } catch { setError('Failed to load cases'); } finally { setLoading(false); }
  }

  async function loadPatients() {
    try {
      const res = await api.get<any>('/patients?limit=500');
      setPatients(res.data || []);
    } catch {}
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_CASE });
    setShowForm(true);
    setError(''); setSuccess('');
  }

  function openEdit(c: any) {
    setEditing(c);
    setForm({
      patient_id: c.patient_id || '', employer_name: c.employer_name || '',
      employer_phone: c.employer_phone || '', employer_contact: c.employer_contact || '',
      injury_date: c.injury_date?.substring(0, 10) || '', claim_number: c.claim_number || '',
      adjuster_name: c.adjuster_name || '', adjuster_phone: c.adjuster_phone || '',
      insurance_carrier: c.insurance_carrier || '', status: c.status || 'open', notes: c.notes || '',
    });
    setShowForm(true);
    setError(''); setSuccess('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      if (editing) {
        await api.put(`/workers-comp/${editing.id}`, form);
        setSuccess('Case updated successfully');
      } else {
        await api.post('/workers-comp', form);
        setSuccess('Case created successfully');
      }
      setShowForm(false);
      loadCases();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    }
  }

  const set = (field: string, val: string) => setForm(f => ({ ...f, [field]: val }));

  const Spinner = () => (
    <div className="flex justify-center py-8">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Workers' Compensation</h1>
        <button onClick={openCreate} className="btn-primary text-sm">+ New Case</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">{success}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <h3 className="sm:col-span-2 lg:col-span-3 font-semibold">{editing ? 'Edit Case' : 'New WC Case'}</h3>
          <div>
            <label className="label">Patient *</label>
            <select value={form.patient_id} onChange={e => set('patient_id', e.target.value)} required className="input">
              <option value="">Select patient...</option>
              {patients.map((p: any) => (
                <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}</option>
              ))}
            </select>
          </div>
          <div><label className="label">Employer *</label><input value={form.employer_name} onChange={e => set('employer_name', e.target.value)} required className="input" /></div>
          <div><label className="label">Employer Phone</label><input value={form.employer_phone} onChange={e => set('employer_phone', e.target.value)} className="input" /></div>
          <div><label className="label">Employer Contact</label><input value={form.employer_contact} onChange={e => set('employer_contact', e.target.value)} className="input" /></div>
          <div><label className="label">Injury Date *</label><input type="date" value={form.injury_date} onChange={e => set('injury_date', e.target.value)} required className="input" /></div>
          <div><label className="label">Claim Number</label><input value={form.claim_number} onChange={e => set('claim_number', e.target.value)} className="input" /></div>
          <div><label className="label">Insurance Carrier</label><input value={form.insurance_carrier} onChange={e => set('insurance_carrier', e.target.value)} className="input" /></div>
          <div><label className="label">Adjuster Name</label><input value={form.adjuster_name} onChange={e => set('adjuster_name', e.target.value)} className="input" /></div>
          <div><label className="label">Adjuster Phone</label><input value={form.adjuster_phone} onChange={e => set('adjuster_phone', e.target.value)} className="input" /></div>
          <div>
            <label className="label">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)} className="input">
              <option value="open">Open</option><option value="closed">Closed</option>
              <option value="denied">Denied</option><option value="settled">Settled</option>
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="label">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} className="input" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? 'Update Case' : 'Create Case'}</button>
          </div>
        </form>
      )}

      <div className="flex gap-2 items-center">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input max-w-xs">
          <option value="">All Statuses</option>
          <option value="open">Open</option><option value="closed">Closed</option>
          <option value="denied">Denied</option><option value="settled">Settled</option>
        </select>
      </div>

      {loading ? <Spinner /> : cases.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No workers' comp cases found</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Patient</th>
                <th className="text-left px-4 py-3">Employer</th>
                <th className="text-left px-4 py-3">Injury Date</th>
                <th className="text-left px-4 py-3">Claim #</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {cases.map((c: any) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{c.patient_last_name}, {c.patient_first_name}</td>
                  <td className="px-4 py-3">{c.employer_name}</td>
                  <td className="px-4 py-3">{c.injury_date ? new Date(c.injury_date).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{c.claim_number || '-'}</td>
                  <td className="px-4 py-3"><span className={STATUS_BADGE[c.status] || 'badge-gray'}>{c.status}</span></td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEdit(c)} className="text-xs text-primary-600 underline">Edit</button>
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
