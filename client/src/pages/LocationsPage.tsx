import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const Spinner = () => (
  <div className="flex justify-center py-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
  </div>
);

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
];

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const EMPTY_LOC = {
  name: '', address_line1: '', address_line2: '', city: '', state: '', zip: '',
  phone: '', fax: '', email: '', timezone: 'America/New_York', is_primary: false,
  npi: '', tax_id: '', operating_hours: {} as Record<string, { open: string; close: string; closed: boolean }>,
};

function buildHours(): Record<string, { open: string; close: string; closed: boolean }> {
  const h: Record<string, { open: string; close: string; closed: boolean }> = {};
  DAYS.forEach(d => { h[d] = { open: '08:00', close: '17:00', closed: d === 'saturday' || d === 'sunday' }; });
  return h;
}

export default function LocationsPage() {
  const { user } = useAuth();
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_LOC, operating_hours: buildHours() });

  useEffect(() => { loadLocations(); }, []);

  async function loadLocations() {
    setLoading(true);
    try {
      const res = await api.get<any>('/locations');
      setLocations(res.data || []);
    } catch { setError('Failed to load locations'); } finally { setLoading(false); }
  }

  function openCreate() {
    setEditing(null); setForm({ ...EMPTY_LOC, operating_hours: buildHours() });
    setShowForm(true); setError(''); setSuccess('');
  }

  function openEdit(loc: any) {
    setEditing(loc);
    const hours = loc.operating_hours || buildHours();
    DAYS.forEach(d => { if (!hours[d]) hours[d] = { open: '08:00', close: '17:00', closed: true }; });
    setForm({
      name: loc.name || '', address_line1: loc.address_line1 || '', address_line2: loc.address_line2 || '',
      city: loc.city || '', state: loc.state || '', zip: loc.zip || '',
      phone: loc.phone || '', fax: loc.fax || '', email: loc.email || '',
      timezone: loc.timezone || 'America/New_York', is_primary: loc.is_primary || false,
      npi: loc.npi || '', tax_id: loc.tax_id || '', operating_hours: hours,
    });
    setShowForm(true); setError(''); setSuccess('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      if (editing) { await api.put(`/locations/${editing.id}`, form); setSuccess('Location updated'); }
      else { await api.post('/locations', form); setSuccess('Location created'); }
      setShowForm(false); loadLocations();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Save failed'); }
  }

  async function deactivate(id: string) {
    if (!confirm('Deactivate this location?')) return;
    try {
      await api.post(`/locations/${id}/deactivate`);
      setSuccess('Location deactivated'); loadLocations();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Failed'); }
  }

  const set = (field: string, val: any) => setForm(f => ({ ...f, [field]: val }));
  const setHour = (day: string, field: string, val: any) => {
    setForm(f => ({ ...f, operating_hours: { ...f.operating_hours, [day]: { ...f.operating_hours[day], [field]: val } } }));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Locations</h1>
        <button onClick={openCreate} className="btn-primary text-sm">+ New Location</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">{success}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h3 className="font-semibold">{editing ? 'Edit Location' : 'New Location'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div><label className="label">Name *</label><input value={form.name} onChange={e => set('name', e.target.value)} required className="input" /></div>
            <div><label className="label">Address Line 1 *</label><input value={form.address_line1} onChange={e => set('address_line1', e.target.value)} required className="input" /></div>
            <div><label className="label">Address Line 2</label><input value={form.address_line2} onChange={e => set('address_line2', e.target.value)} className="input" /></div>
            <div><label className="label">City *</label><input value={form.city} onChange={e => set('city', e.target.value)} required className="input" /></div>
            <div><label className="label">State *</label><input value={form.state} onChange={e => set('state', e.target.value)} required maxLength={2} className="input" /></div>
            <div><label className="label">ZIP *</label><input value={form.zip} onChange={e => set('zip', e.target.value)} required className="input" /></div>
            <div><label className="label">Phone *</label><input value={form.phone} onChange={e => set('phone', e.target.value)} required className="input" /></div>
            <div><label className="label">Fax</label><input value={form.fax} onChange={e => set('fax', e.target.value)} className="input" /></div>
            <div><label className="label">Email</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} className="input" /></div>
            <div><label className="label">NPI</label><input value={form.npi} onChange={e => set('npi', e.target.value)} className="input" /></div>
            <div><label className="label">Tax ID</label><input value={form.tax_id} onChange={e => set('tax_id', e.target.value)} className="input" /></div>
            <div>
              <label className="label">Timezone</label>
              <select value={form.timezone} onChange={e => set('timezone', e.target.value)} className="input">
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace('America/', '').replace('Pacific/', '').replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_primary} onChange={e => set('is_primary', e.target.checked)} className="rounded" />
                Primary Location
              </label>
            </div>
          </div>
          <div>
            <label className="label mb-2">Operating Hours</label>
            <div className="space-y-2">
              {DAYS.map(day => (
                <div key={day} className="flex items-center gap-3 text-sm">
                  <span className="w-24 capitalize">{day}</span>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={!form.operating_hours[day]?.closed} onChange={e => setHour(day, 'closed', !e.target.checked)} className="rounded" />
                    Open
                  </label>
                  {!form.operating_hours[day]?.closed && (
                    <>
                      <input type="time" value={form.operating_hours[day]?.open || '08:00'} onChange={e => setHour(day, 'open', e.target.value)} className="input w-32" />
                      <span>to</span>
                      <input type="time" value={form.operating_hours[day]?.close || '17:00'} onChange={e => setHour(day, 'close', e.target.value)} className="input w-32" />
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? 'Update' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? <Spinner /> : locations.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No locations configured</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Address</th>
                <th className="text-left px-4 py-3">Phone</th>
                <th className="text-left px-4 py-3">Timezone</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {locations.map((loc: any) => (
                <tr key={loc.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    {loc.name}
                    {loc.is_primary && <span className="badge-blue ml-2">Primary</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">{loc.address_line1}, {loc.city}, {loc.state} {loc.zip}</td>
                  <td className="px-4 py-3">{loc.phone}</td>
                  <td className="px-4 py-3 text-xs">{loc.timezone}</td>
                  <td className="px-4 py-3"><span className={loc.is_active !== false ? 'badge-green' : 'badge-red'}>{loc.is_active !== false ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(loc)} className="text-xs text-primary-600 underline">Edit</button>
                      {loc.is_active !== false && <button onClick={() => deactivate(loc.id)} className="text-xs text-red-600 underline">Deactivate</button>}
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
