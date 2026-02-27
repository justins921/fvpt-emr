import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const Spinner = () => (
  <div className="flex justify-center py-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
  </div>
);

const RESOURCE_TYPES = ['Patient', 'Practitioner', 'Encounter', 'Condition', 'Observation', 'AllergyIntolerance', 'MedicationRequest', 'Procedure'];

const EMPTY_CONN = { name: '', base_url: '', auth_type: 'none', client_id: '', client_secret: '', api_key: '' };

export default function FHIRPage() {
  const { user } = useAuth();
  const [connections, setConnections] = useState<any[]>([]);
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_CONN });
  const [testing, setTesting] = useState<string | null>(null);
  const [syncConn, setSyncConn] = useState<string | null>(null);
  const [syncResources, setSyncResources] = useState<string[]>(['Patient']);

  useEffect(() => { loadConnections(); loadSyncLogs(); }, []);

  async function loadConnections() {
    setLoading(true);
    try {
      const res = await api.get<any>('/fhir/connections');
      setConnections(res.data || []);
    } catch { setError('Failed to load connections'); } finally { setLoading(false); }
  }

  async function loadSyncLogs() {
    try {
      const res = await api.get<any>('/fhir/sync-logs?limit=50');
      setSyncLogs(res.data || []);
    } catch {}
  }

  function openCreate() {
    setEditing(null); setForm({ ...EMPTY_CONN }); setShowForm(true); setError(''); setSuccess('');
  }

  function openEdit(c: any) {
    setEditing(c);
    setForm({
      name: c.name || '', base_url: c.base_url || '', auth_type: c.auth_type || 'none',
      client_id: c.client_id || '', client_secret: '', api_key: '',
    });
    setShowForm(true); setError(''); setSuccess('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    const payload: any = { name: form.name, base_url: form.base_url, auth_type: form.auth_type };
    if (form.auth_type === 'oauth2') { payload.client_id = form.client_id; if (form.client_secret) payload.client_secret = form.client_secret; }
    if (form.auth_type === 'api_key' && form.api_key) payload.api_key = form.api_key;
    try {
      if (editing) { await api.put(`/fhir/connections/${editing.id}`, payload); setSuccess('Connection updated'); }
      else { await api.post('/fhir/connections', payload); setSuccess('Connection created'); }
      setShowForm(false); loadConnections();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Save failed'); }
  }

  async function testConnection(id: string) {
    setTesting(id); setError(''); setSuccess('');
    try {
      const res = await api.put<any>(`/fhir/connections/${id}/test`);
      setSuccess(res.data?.message || 'Connection successful');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connection test failed');
    } finally { setTesting(null); }
  }

  async function triggerSync(connId: string) {
    if (syncResources.length === 0) { setError('Select at least one resource type'); return; }
    setError(''); setSuccess('');
    try {
      await api.post(`/fhir/connections/${connId}/sync`, { resource_types: syncResources });
      setSuccess('Sync triggered');
      setSyncConn(null);
      loadSyncLogs();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Sync failed'); }
  }

  function toggleResource(r: string) {
    setSyncResources(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  }

  const set = (field: string, val: string) => setForm(f => ({ ...f, [field]: val }));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">FHIR Connections</h1>
        <button onClick={openCreate} className="btn-primary text-sm">+ New Connection</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">{success}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
          <h3 className="sm:col-span-2 font-semibold">{editing ? 'Edit Connection' : 'New FHIR Connection'}</h3>
          <div><label className="label">Name *</label><input value={form.name} onChange={e => set('name', e.target.value)} required className="input" /></div>
          <div><label className="label">Base URL *</label><input value={form.base_url} onChange={e => set('base_url', e.target.value)} required placeholder="https://fhir.example.com/r4" className="input" /></div>
          <div>
            <label className="label">Auth Type</label>
            <select value={form.auth_type} onChange={e => set('auth_type', e.target.value)} className="input">
              <option value="none">None</option><option value="oauth2">OAuth2</option>
              <option value="api_key">API Key</option><option value="basic">Basic Auth</option>
            </select>
          </div>
          {form.auth_type === 'oauth2' && (
            <>
              <div><label className="label">Client ID</label><input value={form.client_id} onChange={e => set('client_id', e.target.value)} className="input" /></div>
              <div><label className="label">Client Secret</label><input type="password" value={form.client_secret} onChange={e => set('client_secret', e.target.value)} className="input" placeholder={editing ? '(unchanged)' : ''} /></div>
            </>
          )}
          {form.auth_type === 'api_key' && (
            <div><label className="label">API Key</label><input type="password" value={form.api_key} onChange={e => set('api_key', e.target.value)} className="input" placeholder={editing ? '(unchanged)' : ''} /></div>
          )}
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? 'Update' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? <Spinner /> : connections.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No FHIR connections configured</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">URL</th>
                <th className="text-left px-4 py-3">Auth</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {connections.map((c: any) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-xs font-mono truncate max-w-xs">{c.base_url}</td>
                  <td className="px-4 py-3">{c.auth_type}</td>
                  <td className="px-4 py-3"><span className={c.status === 'active' ? 'badge-green' : c.status === 'error' ? 'badge-red' : 'badge-gray'}>{c.status || 'unknown'}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(c)} className="text-xs text-primary-600 underline">Edit</button>
                      <button onClick={() => testConnection(c.id)} disabled={testing === c.id} className="text-xs text-blue-600 underline">
                        {testing === c.id ? 'Testing...' : 'Test'}
                      </button>
                      <button onClick={() => setSyncConn(syncConn === c.id ? null : c.id)} className="text-xs text-green-600 underline">Sync</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {syncConn && (
        <div className="card">
          <h3 className="font-semibold mb-3">Trigger Sync</h3>
          <p className="text-sm text-slate-500 mb-3">Select resource types to sync:</p>
          <div className="flex flex-wrap gap-3 mb-4">
            {RESOURCE_TYPES.map(r => (
              <label key={r} className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={syncResources.includes(r)} onChange={() => toggleResource(r)} className="rounded" />
                {r}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => triggerSync(syncConn)} className="btn-primary text-sm">Start Sync</button>
            <button onClick={() => setSyncConn(null)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {syncLogs.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Sync Log</h3>
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3">Time</th>
                  <th className="text-left px-4 py-3">Connection</th>
                  <th className="text-left px-4 py-3">Resources</th>
                  <th className="text-right px-4 py-3">Records</th>
                  <th className="text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {syncLogs.map((l: any) => (
                  <tr key={l.id} className="hover:bg-slate-50 text-xs">
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">{l.connection_name || l.connection_id?.substring(0, 8)}</td>
                    <td className="px-4 py-3">{l.resource_types?.join(', ') || '-'}</td>
                    <td className="px-4 py-3 text-right font-mono">{l.records_synced ?? '-'}</td>
                    <td className="px-4 py-3"><span className={l.status === 'completed' ? 'badge-green' : l.status === 'failed' ? 'badge-red' : 'badge-yellow'}>{l.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
