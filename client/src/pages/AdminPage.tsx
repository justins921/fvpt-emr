import { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import ImportPage from './ImportPage';
import AISettingsPanel from '../components/AISettingsPanel';

export default function AdminPage() {
  const location = useLocation();
  const { user } = useAuth();
  const tabs = [
    { path: '/app/admin', label: 'Users' },
    { path: '/app/admin/roles', label: 'Roles & Permissions' },
    { path: '/app/admin/audit', label: 'Audit Log' },
    { path: '/app/admin/settings', label: 'Settings' },
    { path: '/app/admin/import', label: 'Import Data' },
  ];

  if (!['owner', 'admin', 'dev'].includes(user?.role || '')) {
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
        <Route index element={<UsersManager currentUserId={user?.id} currentUserRole={user?.role} />} />
        <Route path="roles" element={<RoleMatrix />} />
        <Route path="audit" element={<AuditViewer />} />
        <Route path="settings" element={<SettingsPanel />} />
        <Route path="import" element={<ImportPage />} />
      </Routes>
    </div>
  );
}

const ALL_ROLES = ['owner', 'admin', 'therapist', 'front_desk', 'biller', 'read_only', 'dev'] as const;
const PRIVILEGED_ROLES = ['owner', 'admin'];
const CREDENTIALS = ['PT', 'DPT', 'PTA', 'ATC', 'OT', 'SLP', 'MD', 'DO', 'NP', 'PA', 'Office'];

function roleLabel(r: string) { return r.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()); }

function UsersManager({ currentUserId, currentUserRole }: { currentUserId?: string; currentUserRole?: string }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [createError, setCreateError] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [editError, setEditError] = useState('');
  const [confirmingRoleChange, setConfirmingRoleChange] = useState(false);
  const [editRole, setEditRole] = useState('');
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [invites, setInvites] = useState<any[]>([]);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  useEffect(() => { loadUsers(); loadInvites(); }, []);

  async function loadUsers() {
    try {
      const res = await api.get<any>('/users');
      setUsers(res.data || []);
    } catch { /* keep existing list */ } finally { setLoading(false); }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError('');
    const fd = new FormData(e.currentTarget);
    try {
      await api.post('/users', {
        username: fd.get('username'), password: fd.get('password'),
        firstName: fd.get('firstName'), lastName: fd.get('lastName'),
        role: fd.get('role'), credential: fd.get('credential') || null,
        npi: fd.get('npi') || undefined,
      });
      setShowForm(false); loadUsers();
    } catch (err) { setCreateError(err instanceof ApiError ? err.message : 'Failed to create user'); }
  }

  async function deactivateUser(id: string) {
    if (id === currentUserId) { return; }
    try { await api.post(`/users/${id}/deactivate`); loadUsers(); } catch {}
  }

  async function loadInvites() {
    try {
      const res = await api.get<any>('/users/invites');
      setInvites(res.data || []);
    } catch { /* keep existing list */ }
  }

  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInviteError(''); setInviteLink(''); setCopiedLink(false);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await api.post<any>('/users/invite', {
        email: (fd.get('email') as string)?.trim(),
        role: fd.get('role'),
      });
      const token = res.data?.token;
      if (token) {
        setInviteLink(`${window.location.origin}/invite/${token}`);
      }
      setShowInviteForm(false);
      (e.target as HTMLFormElement).reset();
      loadInvites();
    } catch (err) { setInviteError(err instanceof ApiError ? err.message : 'Failed to create invite'); }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopiedLink(true);
    } catch {
      // Clipboard API unavailable — select the text for manual copy
      const el = document.getElementById('invite-link-text');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  async function revokeInvite(id: string) {
    if (confirmRevokeId !== id) { setConfirmRevokeId(id); return; }
    setConfirmRevokeId(null);
    try { await api.post(`/users/invites/${id}/revoke`); loadInvites(); } catch {}
  }

  const isSelf = (u: any) => u.id === currentUserId;
  const privilegedCount = users.filter(u => PRIVILEGED_ROLES.includes(u.role) && u.is_active).length;
  const isLastPrivileged = (u: any) =>
    PRIVILEGED_ROLES.includes(u.role) && u.is_active && privilegedCount <= 1;

  function openEdit(u: any) {
    setEditing({ ...u });
    setEditRole(u.role);
    setEditError('');
    setConfirmingRoleChange(false);
  }

  function roleChangeBlocked(u: any, newRole: string): string | null {
    if (isSelf(u) && newRole !== u.role) {
      return "You can't change your own role. Ask another administrator.";
    }
    if (PRIVILEGED_ROLES.includes(newRole) && currentUserRole !== 'owner') {
      return 'Only owners can grant owner or admin roles.';
    }
    if (isLastPrivileged(u) && !PRIVILEGED_ROLES.includes(newRole)) {
      return 'Cannot demote the last remaining owner/admin. Promote another user first.';
    }
    return null;
  }

  async function handleEditSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setEditError('');
    const fd = new FormData(e.currentTarget);
    const newRole = editRole || editing.role;
    const blocked = roleChangeBlocked(editing, newRole);
    if (blocked) { setEditError(blocked); return; }
    // Two-click confirm when the role is actually changing
    if (newRole !== editing.role && !confirmingRoleChange) {
      setConfirmingRoleChange(true);
      return;
    }
    try {
      const str = (v: FormDataEntryValue | null) => {
        const s = typeof v === 'string' ? v.trim() : '';
        return s || null;
      };
      await api.put(`/users/${editing.id}`, {
        firstName: (fd.get('firstName') as string)?.trim(),
        lastName: (fd.get('lastName') as string)?.trim(),
        role: newRole, credential: str(fd.get('credential')),
        npi: str(fd.get('npi')), licenseNumber: str(fd.get('licenseNumber')),
        isActive: fd.get('isActive') === 'on',
      });
      setEditing(null); setConfirmingRoleChange(false); loadUsers();
    } catch (err) { setEditError(err instanceof ApiError ? err.message : 'Failed to update user'); }
  }

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h3 className="font-semibold">Users</h3>
        <div className="flex gap-2">
          <button onClick={() => { setShowInviteForm(!showInviteForm); setInviteError(''); }} className="btn-secondary text-sm">Invite User</button>
          <button onClick={() => { setShowForm(!showForm); setCreateError(''); }} className="btn-primary text-sm">+ New User</button>
        </div>
      </div>
      {showInviteForm && (
        <form onSubmit={handleInvite} className="card grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="label">Email *</label><input name="email" type="email" required className="input" placeholder="newhire@example.com" /></div>
          <div><label className="label">Role *</label>
            <select name="role" required className="input" defaultValue="therapist">
              {ALL_ROLES.filter(r => currentUserRole === 'owner' || !PRIVILEGED_ROLES.includes(r)).map(r => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end"><p className="text-xs text-slate-500">They'll get a link to set their own password. Link expires in 7 days.</p></div>
          {inviteError && <div className="sm:col-span-3 text-sm text-red-600">{inviteError}</div>}
          <div className="sm:col-span-3 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowInviteForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Send Invite</button>
          </div>
        </form>
      )}
      {inviteLink && (
        <div className="card border-green-200 bg-green-50 space-y-2" role="status">
          <p className="text-sm font-medium text-green-800">Invite created — share this link with the new user:</p>
          <div className="flex gap-2 items-center">
            <code id="invite-link-text" className="flex-1 text-xs bg-white border rounded px-2 py-2 break-all select-all">{inviteLink}</code>
            <button type="button" onClick={copyInviteLink} className="btn-secondary text-sm whitespace-nowrap">{copiedLink ? 'Copied!' : 'Copy Link'}</button>
          </div>
          <button type="button" onClick={() => setInviteLink('')} className="text-xs text-slate-500 underline">Dismiss</button>
        </div>
      )}
      {showForm && (
        <form onSubmit={handleCreate} className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div><label className="label">Username *</label><input name="username" type="text" required className="input" /></div>
          <div><label className="label">Password *</label><input name="password" type="password" required minLength={8} className="input" /></div>
          <div><label className="label">First Name *</label><input name="firstName" required className="input" /></div>
          <div><label className="label">Last Name *</label><input name="lastName" required className="input" /></div>
          <div><label className="label">Role *</label>
            <select name="role" required className="input" defaultValue="therapist">
              {ALL_ROLES.filter(r => currentUserRole === 'owner' || !PRIVILEGED_ROLES.includes(r)).map(r => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </div>
          <div><label className="label">Credential</label>
            <select name="credential" className="input">
              <option value="">None</option>
              {CREDENTIALS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="label">NPI</label><input name="npi" className="input" /></div>
          {createError && <div className="sm:col-span-2 lg:col-span-3 text-sm text-red-600">{createError}</div>}
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
            <th className="text-left px-4 py-3">Username</th>
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
                <td className="px-4 py-3">{u.username}</td>
                <td className="px-4 py-3 capitalize">{u.role.replace('_', ' ')}</td>
                <td className="px-4 py-3">{u.credential ? <span className="badge-blue">{u.credential}</span> : <span className="text-slate-400">-</span>}</td>
                <td className="px-4 py-3"><span className={u.is_active ? 'badge-green' : 'badge-red'}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                <td className="px-4 py-3 text-xs text-slate-500">{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <button onClick={() => openEdit(u)} className="text-xs text-primary-600 underline mr-3">Edit</button>
                  {u.is_active && !isSelf(u) && <DeactivateButton onDeactivate={() => deactivateUser(u.id)} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invites.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Invites</h3>
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b"><tr>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Expires</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr></thead>
              <tbody className="divide-y">
                {invites.map((inv: any) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{inv.email}</td>
                    <td className="px-4 py-3 capitalize">{roleLabel(inv.role)}</td>
                    <td className="px-4 py-3">
                      <span className={inv.status === 'pending' ? 'badge-yellow' : inv.status === 'accepted' ? 'badge-green' : 'badge-gray'}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{new Date(inv.expires_at).toLocaleString()}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {inv.status === 'pending' && (
                        confirmRevokeId === inv.id ? (
                          <span className="text-xs">
                            <span className="text-amber-700 mr-2">Revoke this invite?</span>
                            <button onClick={() => revokeInvite(inv.id)} className="text-xs text-red-600 underline mr-2">Confirm</button>
                            <button onClick={() => setConfirmRevokeId(null)} className="text-xs text-slate-500 underline">Back</button>
                          </span>
                        ) : (
                          <button onClick={() => revokeInvite(inv.id)} className="text-xs text-red-600 underline">Revoke</button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <form onSubmit={handleEditSave} onClick={e => e.stopPropagation()}
            className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-3" aria-label="Edit user">
            <h3 className="font-semibold text-lg">Edit User — {editing.last_name}, {editing.first_name}</h3>
            {isSelf(editing) && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                This is your own account — the role can't be changed here. Ask another administrator if your role needs to change.
              </p>
            )}
            {isLastPrivileged(editing) && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                This is the last remaining owner/admin. Demote or deactivate only after promoting another user.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">First Name *</label><input name="firstName" required defaultValue={editing.first_name} className="input" /></div>
              <div><label className="label">Last Name *</label><input name="lastName" required defaultValue={editing.last_name} className="input" /></div>
              <div><label className="label">Role *</label>
                <select name="role" required className="input" value={editRole}
                  disabled={isSelf(editing)}
                  onChange={e => { setEditRole(e.target.value); setConfirmingRoleChange(false); }}>
                  {ALL_ROLES.map(r => (
                    <option key={r} value={r}
                      disabled={PRIVILEGED_ROLES.includes(r) && currentUserRole !== 'owner'}>
                      {roleLabel(r)}{PRIVILEGED_ROLES.includes(r) && currentUserRole !== 'owner' ? ' (owners only)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div><label className="label">Credential</label>
                <select name="credential" className="input" defaultValue={editing.credential || ''}>
                  <option value="">None</option>
                  {CREDENTIALS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div><label className="label">NPI</label><input name="npi" defaultValue={editing.npi || ''} className="input" /></div>
              <div><label className="label">License #</label><input name="licenseNumber" defaultValue={editing.license_number || ''} className="input" /></div>
              <div className="col-span-2 flex items-center gap-2">
                <input id="edit-isActive" name="isActive" type="checkbox" defaultChecked={editing.is_active}
                  disabled={isSelf(editing)} className="h-4 w-4" />
                <label htmlFor="edit-isActive" className="text-sm">Active</label>
              </div>
            </div>
            {editError && <p className="text-sm text-red-600" role="alert">{editError}</p>}
            {confirmingRoleChange ? (
              <div className="bg-amber-50 border border-amber-200 rounded p-3" aria-live="polite">
                <p className="text-sm mb-2">
                  Change <strong>{editing.last_name}, {editing.first_name}</strong>'s role from{' '}
                  <strong>{roleLabel(editing.role)}</strong> to <strong>{roleLabel(editRole)}</strong>?
                </p>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setConfirmingRoleChange(false)} className="btn-secondary text-sm">Back</button>
                  <button type="submit" className="btn-primary text-sm">Confirm Role Change</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setEditing(null)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

function DeactivateButton({ onDeactivate }: { onDeactivate: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="text-xs" aria-live="polite">
        <span className="text-slate-600 mr-2">Deactivate? Sessions revoked.</span>
        <button onClick={() => { setConfirming(false); onDeactivate(); }} className="text-red-600 underline mr-2">Confirm</button>
        <button onClick={() => setConfirming(false)} className="text-slate-500 underline">Back</button>
      </span>
    );
  }
  return <button onClick={() => setConfirming(true)} className="text-xs text-red-600 underline">Deactivate</button>;
}

// ── Role permission matrix (read-only reference, data from GET /users/roles) ──

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: 'Full access to everything, including managing owners and clinic settings.',
  admin: 'Full access to everything except managing owners.',
  dev: 'Full access in development; read-only in production.',
  therapist: 'Clinical care: patients, notes, HEP, and treatment documentation.',
  front_desk: 'Front office: scheduling, intake, check-in, and patient communication.',
  biller: 'Revenue cycle: billing, claims, payments, and authorizations.',
  read_only: 'View-only access. Cannot create, edit, or delete anything.',
};

const CAPABILITY_AREAS: { label: string; perms: string[] }[] = [
  { label: 'Patients', perms: ['patient:create', 'patient:edit', 'patient:view', 'patient:delete', 'patient:export'] },
  { label: 'Scheduling', perms: ['schedule:create', 'schedule:edit', 'schedule:view', 'schedule:delete'] },
  { label: 'Clinical notes', perms: ['note:create', 'note:edit', 'note:view', 'note:sign', 'note:amend', 'attachment:upload', 'attachment:view', 'attachment:delete', 'poc:view', 'poc:create', 'poc:edit', 'outcome:view', 'outcome:create'] },
  { label: 'HEP', perms: ['hep:view', 'hep:create', 'hep:edit', 'hep:delete'] },
  { label: 'Billing & claims', perms: ['billing:view', 'billing:create', 'billing:edit', 'billing:export', 'claim:submit', 'claim:view', 'era:import', 'ledger:view', 'ledger:edit', 'payment:view', 'payment:process', 'workers_comp:view', 'workers_comp:manage', 'mips:view', 'mips:manage'] },
  { label: 'Authorizations', perms: ['authorization:view', 'authorization:manage'] },
  { label: 'Messaging & fax', perms: ['messaging:view', 'messaging:send', 'messaging:manage', 'fax:send', 'fax:view'] },
  { label: 'Internal notes', perms: ['patient_note:view', 'patient_note:create', 'patient_note:manage'] },
  { label: 'Communication consent', perms: ['consent:view', 'consent:manage'] },
  { label: 'Intake forms', perms: ['intake:view', 'intake:create', 'intake:manage'] },
  { label: 'Eligibility', perms: ['eligibility:check', 'eligibility:view'] },
  { label: 'Tasks', perms: ['task:view', 'task:create', 'task:manage'] },
  { label: 'Patient portal', perms: ['portal:manage'] },
  { label: 'Administration', perms: ['clinic:manage', 'clinic:view', 'user:create', 'user:edit', 'user:view', 'user:deactivate', 'audit:view', 'data:import', 'backup:manage', 'settings:manage', 'location:view', 'location:manage', 'fhir:manage'] },
  { label: 'Other', perms: ['telehealth:create', 'telehealth:view', 'waitlist:view', 'waitlist:manage', 'recall:view', 'recall:manage', 'referring_provider:view', 'referring_provider:manage', 'text_expander:view', 'text_expander:manage', 'note_template:view', 'note_template:manage', 'support:create', 'support:manage', 'report:view'] },
];

function accessSummary(rolePerms: string[], areaPerms: string[]): string {
  const have = areaPerms.filter(p => rolePerms.includes(p));
  if (have.length === 0) return '—';
  const verbs = [...new Set(have.map(p => p.split(':')[1]))];
  if (verbs.includes('manage')) return 'Full';
  if (verbs.length === 1 && verbs[0] === 'view') return 'View';
  return verbs.map(v => v.charAt(0).toUpperCase() + v.slice(1)).join(', ');
}

function RoleMatrix() {
  const [roles, setRoles] = useState<{ role: string; permissions: string[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<any>('/users/roles');
        setRoles(res.data || []);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load roles');
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  if (error) return <div className="card text-red-600 text-sm">{error}</div>;

  const order = ['owner', 'admin', 'therapist', 'front_desk', 'biller', 'read_only', 'dev'];
  const sorted = [...roles].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Roles & Permissions</h3>
        <p className="text-sm text-slate-500 mt-1">
          What each role can do in the clinic. Assign roles on the Users tab — changes are audit-logged.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {sorted.map(r => (
          <div key={r.role} className="card">
            <h4 className="font-semibold capitalize">{r.role.replace('_', ' ')}</h4>
            <p className="text-xs text-slate-500 mt-1">{ROLE_DESCRIPTIONS[r.role] || ''}</p>
          </div>
        ))}
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 sticky left-0 bg-slate-50">Capability</th>
              {sorted.map(r => (
                <th key={r.role} className="text-left px-4 py-3 capitalize whitespace-nowrap">{r.role.replace('_', ' ')}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {CAPABILITY_AREAS.map(area => (
              <tr key={area.label} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-medium sticky left-0 bg-white whitespace-nowrap">{area.label}</td>
                {sorted.map(r => {
                  const s = accessSummary(r.permissions, area.perms);
                  return (
                    <td key={r.role} className="px-4 py-2 text-xs whitespace-nowrap">
                      {s === '—' ? <span className="text-slate-300">—</span>
                        : s === 'Full' ? <span className="badge-green">Full</span>
                        : s === 'View' ? <span className="badge-gray">View</span>
                        : <span className="text-slate-600">{s}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        "Full" means create/edit/delete/manage; "View" is read-only; otherwise the listed actions apply. Developer is full access in development, read-only in production.
      </p>
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
      <AISettingsPanel />
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
