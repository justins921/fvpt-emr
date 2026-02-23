import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const Spinner = () => (
  <div className="flex justify-center py-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
  </div>
);

const EMPTY_PROVIDER = {
  first_name: '', last_name: '', npi: '', specialty: '', organization: '',
  phone: '', fax: '', email: '', address_line1: '', address_line2: '',
  city: '', state: '', zip: '', auto_fax_notes: false, auto_fax_plan_of_care: false,
};

export default function ReferringProvidersPage() {
  const { user } = useAuth();
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_PROVIDER });
  const [search, setSearch] = useState('');

  useEffect(() => { loadProviders(); }, []);

  async function loadProviders() {
    setLoading(true);
    try {
      const res = await api.get<any>('/referring-providers?limit=200');
      setProviders(res.data || []);
    } catch { setError('Failed to load referring providers'); } finally { setLoading(false); }
  }

  function openCreate() {
    setEditing(null); setForm({ ...EMPTY_PROVIDER }); setShowForm(true); setError(''); setSuccess('');
  }

  function openEdit(p: any) {
    setEditing(p);
    setForm({
      first_name: p.first_name || '', last_name: p.last_name || '', npi: p.npi || '',
      specialty: p.specialty || '', organization: p.organization || '',
      phone: p.phone || '', fax: p.fax || '', email: p.email || '',
      address_line1: p.address_line1 || '', address_line2: p.address_line2 || '',
      city: p.city || '', state: p.state || '', zip: p.zip || '',
      auto_fax_notes: p.auto_fax_notes || false, auto_fax_plan_of_care: p.auto_fax_plan_of_care || false,
    });
    setShowForm(true); setError(''); setSuccess('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      if (editing) { await api.put(`/referring-providers/${editing.id}`, form); setSuccess('Provider updated'); }
      else { await api.post('/referring-providers', form); setSuccess('Provider created'); }
      setShowForm(false); loadProviders();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Save failed'); }
  }

  async function softDelete(id: string) {
    if (!confirm('Remove this referring provider? They can be restored later.')) return;
    setError(''); setSuccess('');
    try {
      await api.delete(`/referring-providers/${id}`);
      setSuccess('Provider removed'); loadProviders();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Delete failed'); }
  }

  const set = (field: string, val: any) => setForm(f => ({ ...f, [field]: val }));

  const filtered = providers.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (p.last_name || '').toLowerCase().includes(q) ||
      (p.first_name || '').toLowerCase().includes(q) ||
      (p.npi || '').includes(q) ||
      (p.organization || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Referring Providers</h1>
        <button onClick={openCreate} className="btn-primary text-sm">+ New Provider</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">{success}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <h3 className="sm:col-span-2 lg:col-span-3 font-semibold">{editing ? 'Edit Provider' : 'New Referring Provider'}</h3>
          <div><label className="label">First Name *</label><input value={form.first_name} onChange={e => set('first_name', e.target.value)} required className="input" /></div>
          <div><label className="label">Last Name *</label><input value={form.last_name} onChange={e => set('last_name', e.target.value)} required className="input" /></div>
          <div><label className="label">NPI *</label><input value={form.npi} onChange={e => set('npi', e.target.value)} required maxLength={10} className="input font-mono" /></div>
          <div><label className="label">Specialty</label><input value={form.specialty} onChange={e => set('specialty', e.target.value)} placeholder="e.g. Orthopedics" className="input" /></div>
          <div><label className="label">Organization</label><input value={form.organization} onChange={e => set('organization', e.target.value)} className="input" /></div>
          <div><label className="label">Phone</label><input value={form.phone} onChange={e => set('phone', e.target.value)} className="input" /></div>
          <div><label className="label">Fax</label><input value={form.fax} onChange={e => set('fax', e.target.value)} className="input" /></div>
          <div><label className="label">Email</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} className="input" /></div>
          <div><label className="label">Address</label><input value={form.address_line1} onChange={e => set('address_line1', e.target.value)} className="input" /></div>
          <div><label className="label">Address Line 2</label><input value={form.address_line2} onChange={e => set('address_line2', e.target.value)} className="input" /></div>
          <div><label className="label">City</label><input value={form.city} onChange={e => set('city', e.target.value)} className="input" /></div>
          <div><label className="label">State</label><input value={form.state} onChange={e => set('state', e.target.value)} maxLength={2} className="input" /></div>
          <div><label className="label">ZIP</label><input value={form.zip} onChange={e => set('zip', e.target.value)} className="input" /></div>
          <div className="flex flex-col gap-2 justify-center">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.auto_fax_notes} onChange={e => set('auto_fax_notes', e.target.checked)} className="rounded" />
              Auto-fax visit notes
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.auto_fax_plan_of_care} onChange={e => set('auto_fax_plan_of_care', e.target.checked)} className="rounded" />
              Auto-fax plan of care
            </label>
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? 'Update' : 'Create'}</button>
          </div>
        </form>
      )}

      <div className="flex gap-2 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, NPI, or organization..." className="input max-w-md" />
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">{search ? 'No matching providers' : 'No referring providers found'}</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">NPI</th>
                <th className="text-left px-4 py-3">Specialty</th>
                <th className="text-left px-4 py-3">Organization</th>
                <th className="text-left px-4 py-3">Fax</th>
                <th className="text-left px-4 py-3">Auto-Fax</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((p: any) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{p.last_name}, {p.first_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.npi || '-'}</td>
                  <td className="px-4 py-3">{p.specialty || '-'}</td>
                  <td className="px-4 py-3">{p.organization || '-'}</td>
                  <td className="px-4 py-3">{p.fax || '-'}</td>
                  <td className="px-4 py-3">
                    {(p.auto_fax_notes || p.auto_fax_plan_of_care) ? (
                      <div className="flex gap-1">
                        {p.auto_fax_notes && <span className="badge-blue text-xs">Notes</span>}
                        {p.auto_fax_plan_of_care && <span className="badge-blue text-xs">POC</span>}
                      </div>
                    ) : <span className="text-slate-400">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(p)} className="text-xs text-primary-600 underline">Edit</button>
                      <button onClick={() => softDelete(p.id)} className="text-xs text-red-600 underline">Remove</button>
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
