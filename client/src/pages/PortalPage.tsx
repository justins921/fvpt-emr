import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface PortalUser {
  id: string;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  email: string;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

interface PortalMessage {
  id: string;
  portal_user_id: string;
  patient_first_name: string;
  patient_last_name: string;
  subject: string;
  body: string;
  direction: 'inbound' | 'outbound';
  is_read: boolean;
  created_at: string;
  sender_name: string | null;
}

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  mrn: string;
  email: string | null;
}

type Tab = 'users' | 'messages';

export default function PortalPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('users');
  const tabCls = (t: Tab) => `px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Patient Portal</h1>
        <p className="text-sm text-slate-500 mt-1">Manage portal access and patient communications</p>
      </div>
      <div className="flex gap-1 border-b">
        <button onClick={() => setTab('users')} className={tabCls('users')}>Portal Users</button>
        <button onClick={() => setTab('messages')} className={tabCls('messages')}>Messages</button>
      </div>
      {tab === 'users' ? <PortalUsersSection /> : <PortalMessagesSection />}
    </div>
  );
}

function Alert({ type, msg, onDismiss }: { type: 'success' | 'error'; msg: string; onDismiss?: () => void }) {
  const cls = type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700';
  return (
    <div className={`border px-4 py-3 rounded-lg text-sm ${cls}`}>
      {msg}{onDismiss && <button onClick={onDismiss} className="ml-2 underline">dismiss</button>}
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
}

/* ─── Portal Users ─── */
function PortalUsersSection() {
  const [portalUsers, setPortalUsers] = useState<PortalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [creating, setCreating] = useState(false);
  const [formPatientId, setFormPatientId] = useState('');
  const [formEmail, setFormEmail] = useState('');

  useEffect(() => { loadPortalUsers(); }, []);
  useEffect(() => { if (showCreate && patients.length === 0) loadPatients(); }, [showCreate]);

  async function loadPortalUsers() {
    setLoading(true); setError('');
    try { const res = await api.get<any>('/portal/users'); setPortalUsers(res.data || []); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Failed to load portal users'); }
    finally { setLoading(false); }
  }

  async function loadPatients() {
    try { const res = await api.get<any>('/patients?limit=200'); setPatients(res.data || []); } catch {}
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formPatientId || !formEmail.trim()) return;
    setCreating(true); setError('');
    try {
      await api.post('/portal/users', { patientId: formPatientId, email: formEmail.trim() });
      setSuccess('Portal user created. Login credentials will be sent to the patient.');
      setShowCreate(false); setFormPatientId(''); setFormEmail('');
      loadPortalUsers(); setTimeout(() => setSuccess(''), 5000);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Failed to create portal user'); }
    finally { setCreating(false); }
  }

  async function toggleActive(userId: string, active: boolean) {
    setError('');
    try {
      await api.post(`/portal/users/${userId}/${active ? 'deactivate' : 'activate'}`);
      setSuccess(active ? 'Portal user deactivated' : 'Portal user reactivated');
      loadPortalUsers(); setTimeout(() => setSuccess(''), 4000);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Failed to update user status'); }
  }

  const selPat = patients.find(p => p.id === formPatientId);

  return (
    <div className="space-y-4">
      {success && <Alert type="success" msg={success} />}
      {error && <Alert type="error" msg={error} onDismiss={() => setError('')} />}

      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Portal Users</h3>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary text-sm">+ Create Portal User</button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h3 className="font-semibold">Create Portal Access</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Patient *</label>
              <select value={formPatientId} onChange={e => { setFormPatientId(e.target.value); const p = patients.find(pt => pt.id === e.target.value); if (p?.email) setFormEmail(p.email); }} required className="input">
                <option value="">Select patient...</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.last_name}, {p.first_name} ({p.mrn})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Email Address *</label>
              <input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} required className="input" placeholder="patient@example.com" />
              {selPat?.email && selPat.email !== formEmail && <div className="text-xs text-slate-500 mt-1">On file: {selPat.email}</div>}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowCreate(false); setFormPatientId(''); setFormEmail(''); }} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={creating} className="btn-primary">{creating ? 'Creating...' : 'Create User'}</button>
          </div>
        </form>
      )}

      {loading ? <Spinner /> : portalUsers.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No portal users found. Create one to give a patient access.</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b"><tr>
              <th className="text-left px-4 py-3">Patient</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Last Login</th>
              <th className="text-left px-4 py-3">Created</th>
              <th className="text-left px-4 py-3">Actions</th>
            </tr></thead>
            <tbody className="divide-y">
              {portalUsers.map(u => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{u.patient_last_name}, {u.patient_first_name}</td>
                  <td className="px-4 py-3 text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(u.id, u.is_active)} className={`text-xs underline ${u.is_active ? 'text-red-600' : 'text-green-600'}`}>
                      {u.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
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

/* ─── Portal Messages ─── */
function PortalMessagesSection() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<PortalMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [replySubject, setReplySubject] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [portalUsers, setPortalUsers] = useState<PortalUser[]>([]);
  const [newUserId, setNewUserId] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [newBody, setNewBody] = useState('');
  const [sendingNew, setSendingNew] = useState(false);

  useEffect(() => { loadMessages(); }, []);
  useEffect(() => { if (selectedUserId) loadThread(selectedUserId); }, [selectedUserId]);
  useEffect(() => { if (showNewMessage && portalUsers.length === 0) loadPortalUsers(); }, [showNewMessage]);

  async function loadMessages() {
    setLoading(true); setError('');
    try { const res = await api.get<any>('/portal/messages?limit=50'); setMessages(res.data || []); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Failed to load messages'); }
    finally { setLoading(false); }
  }

  async function loadThread(uid: string) {
    setLoadingThread(true);
    try {
      const res = await api.get<any>(`/portal/messages/user/${uid}`);
      setThreadMessages(res.data || []);
      for (const m of (res.data || []).filter((m: PortalMessage) => m.direction === 'inbound' && !m.is_read)) {
        api.patch(`/portal/messages/${m.id}/read`).catch(() => {});
      }
    } catch {} finally { setLoadingThread(false); }
  }

  async function loadPortalUsers() {
    try { const res = await api.get<any>('/portal/users'); setPortalUsers((res.data || []).filter((u: PortalUser) => u.is_active)); } catch {}
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUserId || !replyBody.trim()) return;
    setSendingReply(true); setError('');
    try {
      await api.post('/portal/messages', { portalUserId: selectedUserId, subject: replySubject.trim() || 'Re: Message', body: replyBody.trim() });
      setReplySubject(''); setReplyBody('');
      loadThread(selectedUserId); loadMessages();
      setSuccess('Reply sent'); setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Failed to send reply'); }
    finally { setSendingReply(false); }
  }

  async function handleNewMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newUserId || !newBody.trim() || !newSubject.trim()) return;
    setSendingNew(true); setError('');
    try {
      await api.post('/portal/messages', { portalUserId: newUserId, subject: newSubject.trim(), body: newBody.trim() });
      setShowNewMessage(false); setNewUserId(''); setNewSubject(''); setNewBody('');
      loadMessages(); setSuccess('Message sent'); setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Failed to send message'); }
    finally { setSendingNew(false); }
  }

  const conversations = messages.reduce<Record<string, PortalMessage>>((acc, m) => {
    if (!acc[m.portal_user_id] || new Date(m.created_at) > new Date(acc[m.portal_user_id].created_at)) acc[m.portal_user_id] = m;
    return acc;
  }, {});
  const convoList = Object.values(conversations).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="space-y-4">
      {success && <Alert type="success" msg={success} />}
      {error && <Alert type="error" msg={error} onDismiss={() => setError('')} />}

      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Portal Messages</h3>
        <button onClick={() => setShowNewMessage(!showNewMessage)} className="btn-primary text-sm">+ New Message</button>
      </div>

      {showNewMessage && (
        <form onSubmit={handleNewMessage} className="card space-y-3">
          <h3 className="font-semibold text-sm">New Message to Patient</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Patient *</label>
              <select value={newUserId} onChange={e => setNewUserId(e.target.value)} required className="input">
                <option value="">Select portal user...</option>
                {portalUsers.map(u => <option key={u.id} value={u.id}>{u.patient_last_name}, {u.patient_first_name} ({u.email})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Subject *</label>
              <input type="text" value={newSubject} onChange={e => setNewSubject(e.target.value)} required className="input" placeholder="Message subject" />
            </div>
          </div>
          <div>
            <label className="label">Message *</label>
            <textarea value={newBody} onChange={e => setNewBody(e.target.value)} required className="input" rows={3} placeholder="Type your message..." />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowNewMessage(false); setNewUserId(''); setNewSubject(''); setNewBody(''); }} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={sendingNew} className="btn-primary">{sendingNew ? 'Sending...' : 'Send Message'}</button>
          </div>
        </form>
      )}

      {loading ? <Spinner /> : (
        <div className="flex gap-4" style={{ minHeight: '400px' }}>
          {/* Conversation List */}
          <div className="w-full sm:w-80 flex-shrink-0 space-y-1">
            {convoList.length === 0 ? (
              <div className="card text-center text-slate-400 text-sm py-8">No messages yet</div>
            ) : (
              <div className="space-y-1 max-h-[600px] overflow-y-auto">
                {convoList.map(c => (
                  <button key={c.portal_user_id} onClick={() => setSelectedUserId(c.portal_user_id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${selectedUserId === c.portal_user_id ? 'bg-primary-50 border border-primary-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-slate-900">{c.patient_last_name}, {c.patient_first_name}</span>
                      {c.direction === 'inbound' && !c.is_read && <span className="w-2 h-2 bg-primary-600 rounded-full"></span>}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                      <span className={c.direction === 'inbound' ? 'text-blue-500' : 'text-green-500'}>{c.direction === 'inbound' ? '\u2193' : '\u2191'}</span>
                      <span className="truncate">{c.subject}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {new Date(c.created_at).toLocaleDateString()} {new Date(c.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Thread View */}
          <div className="hidden sm:flex flex-col flex-1 card p-0 overflow-hidden">
            {!selectedUserId ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Select a conversation to view messages</div>
            ) : loadingThread ? (
              <div className="flex-1 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
            ) : (
              <>
                {threadMessages.length > 0 && (
                  <div className="px-4 py-3 border-b bg-slate-50">
                    <div className="font-semibold text-sm">{threadMessages[0].patient_last_name}, {threadMessages[0].patient_first_name}</div>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: '400px' }}>
                  {threadMessages.length === 0 ? (
                    <div className="text-center text-slate-400 text-sm py-8">No messages in this conversation</div>
                  ) : threadMessages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${msg.direction === 'outbound' ? 'bg-primary-600 text-white rounded-br-md' : 'bg-slate-100 text-slate-900 rounded-bl-md'}`}>
                        <div className={`text-xs font-medium mb-1 ${msg.direction === 'outbound' ? 'text-primary-200' : 'text-slate-500'}`}>{msg.subject}</div>
                        <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                        <div className={`text-xs mt-1 flex items-center gap-1 ${msg.direction === 'outbound' ? 'text-primary-200' : 'text-slate-400'}`}>
                          {msg.sender_name && <span>{msg.sender_name}</span>}
                          <span>{new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                          {msg.direction === 'inbound' && <span>{msg.is_read ? 'Read' : 'Unread'}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <form onSubmit={handleReply} className="border-t px-4 py-3 space-y-2">
                  <input type="text" value={replySubject} onChange={e => setReplySubject(e.target.value)} className="input text-sm" placeholder="Subject (optional)" />
                  <div className="flex gap-2">
                    <textarea value={replyBody} onChange={e => setReplyBody(e.target.value)} className="input flex-1 text-sm" rows={2} placeholder="Type a reply..." />
                    <button type="submit" disabled={sendingReply || !replyBody.trim()} className="btn-primary text-sm px-4 self-end">{sendingReply ? '...' : 'Send'}</button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
