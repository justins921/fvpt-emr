import { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

export default function AdminPage() {
  const location = useLocation();
  const { user } = useAuth();
  const tabs = [
    { path: '/admin', label: 'Users' },
    { path: '/admin/audit', label: 'Audit Log' },
    { path: '/admin/settings', label: 'Settings' },
  ];

  if (!['owner', 'admin'].includes(user?.role || '')) {
    return <div className="card text-center py-8 text-slate-500">Access restricted to administrators</div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Administration</h1>
      <div className="flex gap-1 border-b border-slate-200 pb-1">
        {tabs.map(tab => (
          <Link key={tab.path} to={tab.path}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg ${location.pathname === tab.path ? 'bg-white border border-b-white border-slate-200 -mb-px' : 'text-slate-500 hover:text-slate-700'}`}
          >{tab.label}</Link>
        ))}
      </div>
      <Routes>
        <Route index element={<UsersManager />} />
        <Route path="audit" element={<AuditViewer />} />
        <Route path="settings" element={<SettingsPanel />} />
      </Routes>
    </div>
  );
}

function UsersManager() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    try { const res = await api.get<any>('/users'); setUsers(res.data || []); } catch {} finally { setLoading(false); }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await api.post('/users', {
        email: fd.get('email'), password: fd.get('password'),
        firstName: fd.get('firstName'), lastName: fd.get('lastName'),
        role: fd.get('role'), credential: fd.get('credential') || null,
        npi: fd.get('npi') || undefined,
      });
      setShowForm(false); loadUsers();
    } catch (err) { alert(err instanceof ApiError ? err.message : 'Failed'); }
  }

  async function deactivateUser(id: string) {
    if (!confirm('Deactivate this user? Their sessions will be revoked.')) return;
    try { await api.post(`/users/${id}/deactivate`); loadUsers(); } catch {}
  }

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h3 className="font-semibold">Users</h3>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">+ New User</button>
      </div>
      {showForm && (
        <form onSubmit={handleCreate} className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div><label className="label">Email *</label><input name="email" type="email" required className="input" /></div>
          <div><label className="label">Password *</label><input name="password" type="password" required minLength={8} className="input" /></div>
          <div><label className="label">First Name *</label><input name="firstName" required className="input" /></div>
          <div><label className="label">Last Name *</label><input name="lastName" required className="input" /></div>
          <div><label className="label">Role *</label>
            <select name="role" required className="input">
              <option value="therapist">Therapist</option>
              <option value="front_desk">Front Desk</option>
              <option value="biller">Biller</option>
              <option value="read_only">Read Only</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div><label className="label">Credential</label>
            <select name="credential" className="input">
              <option value="">None</option>
              <option value="PT">PT</option>
              <option value="DPT">DPT</option>
              <option value="PTA">PTA</option>
              <option value="ATC">ATC</option>
              <option value="OT">OT</option>
              <option value="SLP">SLP</option>
              <option value="Office">Office</option>
            </select>
          </div>
          <div><label className="label">NPI</label><input name="npi" className="input" /></div>
          <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create User</button>
          </div>
        </form>
      )}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b"><tr>
            <th className="text-left px-4 py-3">Name</th>
            <th className="text-left px-4 py-3">Email</th>
            <th className="text-left px-4 py-3">Role</th>
            <th className="text-left px-4 py-3">Credential</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Last Login</th>
            <th className="text-left px-4 py-3">Actions</th>
          </tr></thead>
          <tbody className="divide-y">
            {users.map((u: any) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{u.last_name}, {u.first_name}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3 capitalize">{u.role.replace('_', ' ')}</td>
                <td className="px-4 py-3">{u.credential ? <span className="badge-blue">{u.credential}</span> : <span className="text-slate-400">-</span>}</td>
                <td className="px-4 py-3"><span className={u.is_active ? 'badge-green' : 'badge-red'}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                <td className="px-4 py-3 text-xs text-slate-500">{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
                <td className="px-4 py-3">{u.is_active && <button onClick={() => deactivateUser(u.id)} className="text-xs text-red-600 underline">Deactivate</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditViewer() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');

  useEffect(() => { loadAudit(); }, [actionFilter]);

  async function loadAudit() {
    setLoading(true);
    try {
      const res = await api.get<any>(`/audit?limit=100${actionFilter ? `&action=${actionFilter}` : ''}`);
      setEvents(res.data || []);
    } catch {} finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="input max-w-xs">
          <option value="">All Actions</option>
          <option value="auth.login">Login</option>
          <option value="auth.login_failed">Login Failed</option>
          <option value="patient.view">Patient View</option>
          <option value="chart.open">Chart Open</option>
          <option value="note.sign">Note Sign</option>
          <option value="claim.create">Claim Create</option>
          <option value="era.post">ERA Post</option>
        </select>
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b"><tr>
              <th className="text-left px-3 py-2">Time</th>
              <th className="text-left px-3 py-2">User</th>
              <th className="text-left px-3 py-2">Action</th>
              <th className="text-left px-3 py-2">Resource</th>
              <th className="text-left px-3 py-2">IP</th>
            </tr></thead>
            <tbody className="divide-y">
              {events.map((e: any) => (
                <tr key={e.id} className="hover:bg-slate-50 text-xs">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{e.first_name} {e.last_name}</td>
                  <td className="px-3 py-2"><span className="badge-gray">{e.action}</span></td>
                  <td className="px-3 py-2 font-mono text-slate-500">{e.resource_type}:{e.resource_id?.substring(0, 8)}</td>
                  <td className="px-3 py-2 text-slate-500">{e.ip_address}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsPanel() {
  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="font-semibold mb-3">System Information</h3>
        <dl className="space-y-2 text-sm">
          <div className="flex"><dt className="w-40 text-slate-500">Version</dt><dd>0.1.0</dd></div>
          <div className="flex"><dt className="w-40 text-slate-500">Environment</dt><dd>Local On-Premises</dd></div>
          <div className="flex"><dt className="w-40 text-slate-500">Database</dt><dd>PostgreSQL 16</dd></div>
          <div className="flex"><dt className="w-40 text-slate-500">Encryption</dt><dd>HTTPS (TLS) + At-rest guidance</dd></div>
        </dl>
      </div>
      <div className="card">
        <h3 className="font-semibold mb-3">Security</h3>
        <p className="text-sm text-slate-500 mb-3">
          Session timeout: 15 minutes idle, 12 hours absolute. MFA: ready (not yet enabled).
        </p>
        <div className="space-y-2">
          <button className="btn-secondary text-sm">Rotate JWT Secret</button>
          <button className="btn-secondary text-sm ml-2">Revoke All Sessions</button>
        </div>
      </div>
      <div className="card">
        <h3 className="font-semibold mb-3">Backups</h3>
        <p className="text-sm text-slate-500">Automated backups via cron. See /docs/backup-restore.md for configuration.</p>
      </div>
    </div>
  );
}
