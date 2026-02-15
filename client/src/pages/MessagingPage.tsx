import { useState, useEffect, useRef, FormEvent } from 'react';
import { api } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface Conversation {
  patient_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  last_message_body: string;
  last_message_at: string;
  last_direction: string;
  unread_count: number;
  total_count: number;
}

interface Message {
  id: string;
  direction: string;
  body: string;
  status: string;
  message_type: string;
  sender_first: string | null;
  sender_last: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  date_of_birth: string;
}

interface Template {
  id: string;
  name: string;
  body: string;
  template_type: string;
  creator_first: string;
  creator_last: string;
}

interface Stats {
  totalMessages: number;
  todayMessages: number;
  unreadMessages: number;
  tomorrowReminders: number;
  todayBirthdays: number;
}

interface SearchResult {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  mrn: string;
}

type Tab = 'conversations' | 'templates';

const TYPE_LABELS: Record<string, string> = {
  manual: 'Message', reminder: 'Reminder', birthday: 'Birthday', follow_up: 'Follow-up', custom: 'Custom',
};
const STATUS_ICONS: Record<string, string> = {
  queued: '...', sending: '...', sent: '>', delivered: '>>', failed: '!', received: '',
};

export default function MessagingPage() {
  const { user } = useAuth();
  const canManage = ['owner', 'admin', 'dev'].includes(user?.role || '');

  const [tab, setTab] = useState<Tab>('conversations');
  const [smsConfigured, setSmsConfigured] = useState<boolean | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  // Conversations
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convoSearch, setConvoSearch] = useState('');
  const [loadingConvos, setLoadingConvos] = useState(true);

  // Thread view
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Compose (new conversation)
  const [showCompose, setShowCompose] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchingPatients, setSearchingPatients] = useState(false);

  // Templates
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);

  // Bulk actions
  const [bulkResult, setBulkResult] = useState<{ type: string; total: number; sent: number; failed: number } | null>(null);
  const [bulkSending, setBulkSending] = useState(false);

  // Success/error
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadConfig();
    loadStats();
    loadConversations();
  }, []);

  useEffect(() => {
    if (tab === 'templates' && templates.length === 0) loadTemplates();
  }, [tab]);

  useEffect(() => {
    if (selectedPatientId) loadMessages(selectedPatientId);
  }, [selectedPatientId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Debounced patient search
  useEffect(() => {
    if (patientSearch.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(() => searchPatients(patientSearch), 300);
    return () => clearTimeout(timer);
  }, [patientSearch]);

  // Debounced conversation search
  useEffect(() => {
    const timer = setTimeout(() => loadConversations(), 300);
    return () => clearTimeout(timer);
  }, [convoSearch]);

  async function loadConfig() {
    try {
      const res = await api.get<any>('/messaging/config');
      setSmsConfigured(res.data?.configured ?? false);
    } catch { setSmsConfigured(false); }
  }

  async function loadStats() {
    try {
      const res = await api.get<any>('/messaging/stats');
      setStats(res.data);
    } catch {}
  }

  async function loadConversations() {
    try {
      const qs = convoSearch ? `?search=${encodeURIComponent(convoSearch)}` : '';
      const res = await api.get<any>(`/messaging/conversations${qs}`);
      setConversations(res.data || []);
    } catch {} finally {
      setLoadingConvos(false);
    }
  }

  async function loadMessages(patientId: string) {
    setLoadingMessages(true);
    try {
      const res = await api.get<any>(`/messaging/patient/${patientId}`);
      setMessages(res.data?.messages || []);
      setSelectedPatient(res.data?.patient || null);
    } catch {} finally {
      setLoadingMessages(false);
    }
  }

  async function searchPatients(q: string) {
    setSearchingPatients(true);
    try {
      const res = await api.get<any>(`/messaging/patients/search?q=${encodeURIComponent(q)}`);
      setSearchResults(res.data || []);
    } catch {} finally {
      setSearchingPatients(false);
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!messageInput.trim() || !selectedPatientId) return;
    setSending(true);
    setError('');
    try {
      await api.post('/messaging/send', {
        patientId: selectedPatientId,
        body: messageInput.trim(),
      });
      setMessageInput('');
      loadMessages(selectedPatientId);
      loadConversations();
      loadStats();
    } catch (err: any) {
      setError(err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  async function handleBulkSend(type: 'reminder' | 'birthday') {
    // Find the first template matching the type
    const tmpl = templates.find(t => t.template_type === type);
    setBulkSending(true);
    setError('');
    setBulkResult(null);
    try {
      const res = await api.post<any>('/messaging/send-bulk', {
        type,
        templateId: tmpl?.id,
        customBody: tmpl ? undefined : (type === 'reminder'
          ? 'Hi {{first_name}}, this is a reminder about your appointment on {{appointment_date}} at {{appointment_time}}. Please call {{clinic_phone}} if you need to reschedule.'
          : 'Happy Birthday, {{first_name}}! Wishing you a wonderful day from {{clinic_name}}.'),
      });
      setBulkResult({ type, ...res.data });
      setSuccess(`${type === 'reminder' ? 'Reminders' : 'Birthday messages'} sent: ${res.data.sent} of ${res.data.total}`);
      loadConversations();
      loadStats();
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to send');
    } finally {
      setBulkSending(false);
    }
  }

  function selectPatientForCompose(patient: SearchResult) {
    setSelectedPatientId(patient.id);
    setShowCompose(false);
    setPatientSearch('');
    setSearchResults([]);
  }

  async function loadTemplates() {
    setLoadingTemplates(true);
    try {
      const res = await api.get<any>('/messaging/templates');
      setTemplates(res.data || []);
    } catch {} finally {
      setLoadingTemplates(false);
    }
  }

  async function handleSaveTemplate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: fd.get('name') as string,
      body: fd.get('body') as string,
      templateType: fd.get('templateType') as string,
    };
    try {
      if (editingTemplate) {
        await api.put(`/messaging/templates/${editingTemplate.id}`, payload);
      } else {
        await api.post('/messaging/templates', payload);
      }
      setShowTemplateForm(false);
      setEditingTemplate(null);
      loadTemplates();
    } catch (err: any) {
      setError(err.message || 'Failed to save template');
    }
  }

  async function handleDeleteTemplate(id: string) {
    try {
      await api.delete(`/messaging/templates/${id}`);
      loadTemplates();
    } catch {}
  }

  function useTemplate(tmpl: Template) {
    setMessageInput(tmpl.body);
    setTab('conversations');
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Messages</h1>
          <p className="text-sm text-slate-500 mt-1">Send texts, appointment reminders, and birthday messages</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCompose(true)} className="btn-primary text-sm">+ New Message</button>
        </div>
      </div>

      {/* SMS not configured banner */}
      {smsConfigured === false && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm">
          SMS provider not configured. Messages will be saved but not delivered. Add Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER) to enable delivery.
        </div>
      )}

      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}<button onClick={() => setError('')} className="ml-2 underline">dismiss</button></div>}

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card py-3 text-center">
            <div className="text-2xl font-bold text-slate-900">{stats.todayMessages}</div>
            <div className="text-xs text-slate-500">Today</div>
          </div>
          <div className="card py-3 text-center">
            <div className="text-2xl font-bold text-primary-600">{stats.unreadMessages}</div>
            <div className="text-xs text-slate-500">Unread</div>
          </div>
          <div className="card py-3 text-center cursor-pointer hover:shadow-md transition-shadow" onClick={() => !bulkSending && canManage && stats.tomorrowReminders > 0 && handleBulkSend('reminder')}>
            <div className="text-2xl font-bold text-blue-600">{stats.tomorrowReminders}</div>
            <div className="text-xs text-slate-500">{canManage && stats.tomorrowReminders > 0 ? 'Send Reminders' : 'Tomorrow Appts'}</div>
          </div>
          <div className="card py-3 text-center cursor-pointer hover:shadow-md transition-shadow" onClick={() => !bulkSending && canManage && stats.todayBirthdays > 0 && handleBulkSend('birthday')}>
            <div className="text-2xl font-bold text-pink-600">{stats.todayBirthdays}</div>
            <div className="text-xs text-slate-500">{canManage && stats.todayBirthdays > 0 ? 'Send Birthday Msgs' : 'Birthdays Today'}</div>
          </div>
        </div>
      )}

      {bulkSending && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          Sending messages...
        </div>
      )}

      {/* Bulk result */}
      {bulkResult && (
        <div className="bg-slate-50 border rounded-lg px-4 py-3 text-sm">
          <span className="font-medium">{bulkResult.type === 'reminder' ? 'Reminder' : 'Birthday'} results:</span> {bulkResult.sent} sent, {bulkResult.failed} failed of {bulkResult.total} total
          {!smsConfigured && <span className="text-amber-600 ml-2">(queued - SMS provider not configured)</span>}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button onClick={() => setTab('conversations')} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'conversations' ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          Conversations
        </button>
        {canManage && (
          <button onClick={() => setTab('templates')} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'templates' ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            Templates
          </button>
        )}
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">New Message</h3>
            <button onClick={() => { setShowCompose(false); setPatientSearch(''); setSearchResults([]); }} className="text-slate-400 hover:text-slate-600">X</button>
          </div>
          <div>
            <label className="label">Search Patient</label>
            <input
              value={patientSearch}
              onChange={e => setPatientSearch(e.target.value)}
              className="input"
              placeholder="Type name, phone, or MRN..."
              autoFocus
            />
          </div>
          {searchingPatients && <div className="text-sm text-slate-400">Searching...</div>}
          {searchResults.length > 0 && (
            <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
              {searchResults.map(p => (
                <button
                  key={p.id}
                  onClick={() => selectPatientForCompose(p)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm flex justify-between items-center"
                >
                  <span className="font-medium">{p.last_name}, {p.first_name}</span>
                  <span className="text-slate-400">{p.phone || 'No phone'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'conversations' && (
        <div className="flex gap-4" style={{ minHeight: '500px' }}>
          {/* Conversation list */}
          <div className="w-full sm:w-80 flex-shrink-0 space-y-2">
            <input
              value={convoSearch}
              onChange={e => setConvoSearch(e.target.value)}
              className="input text-sm"
              placeholder="Search conversations..."
            />
            {loadingConvos ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">
                No conversations yet. Click "New Message" to start.
              </div>
            ) : (
              <div className="space-y-1 max-h-[600px] overflow-y-auto">
                {conversations.map(c => (
                  <button
                    key={c.patient_id}
                    onClick={() => setSelectedPatientId(c.patient_id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                      selectedPatientId === c.patient_id ? 'bg-primary-50 border border-primary-200' : 'hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-slate-900">{c.last_name}, {c.first_name}</span>
                      {c.unread_count > 0 && (
                        <span className="bg-primary-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">{c.unread_count}</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {c.last_direction === 'inbound' ? '' : 'You: '}{c.last_message_body}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {new Date(c.last_message_at).toLocaleDateString()} {new Date(c.last_message_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Message thread */}
          <div className="hidden sm:flex flex-col flex-1 card p-0 overflow-hidden">
            {!selectedPatientId ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                Select a conversation or start a new message
              </div>
            ) : loadingMessages ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              </div>
            ) : (
              <>
                {/* Thread header */}
                {selectedPatient && (
                  <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-sm">{selectedPatient.first_name} {selectedPatient.last_name}</div>
                      <div className="text-xs text-slate-500">{selectedPatient.phone || 'No phone'}</div>
                    </div>
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: '450px' }}>
                  {messages.length === 0 ? (
                    <div className="text-center text-slate-400 text-sm py-8">No messages yet. Send the first one below.</div>
                  ) : (
                    messages.map(msg => (
                      <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                          msg.direction === 'outbound'
                            ? 'bg-primary-600 text-white rounded-br-md'
                            : 'bg-slate-100 text-slate-900 rounded-bl-md'
                        }`}>
                          <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                          <div className={`text-xs mt-1 flex items-center gap-1 ${
                            msg.direction === 'outbound' ? 'text-primary-200' : 'text-slate-400'
                          }`}>
                            {msg.direction === 'outbound' && msg.sender_first && (
                              <span>{msg.sender_first} {msg.sender_last?.[0]}.</span>
                            )}
                            <span>{new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                            {msg.direction === 'outbound' && (
                              <span title={msg.status}>{STATUS_ICONS[msg.status] || ''}</span>
                            )}
                            {msg.message_type !== 'manual' && (
                              <span className="opacity-75">{TYPE_LABELS[msg.message_type]}</span>
                            )}
                          </div>
                          {msg.status === 'failed' && msg.error_message && (
                            <div className="text-xs text-red-200 mt-1">Failed: {msg.error_message}</div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={threadEndRef} />
                </div>

                {/* Compose bar */}
                <form onSubmit={handleSend} className="border-t px-4 py-3 flex gap-2">
                  <input
                    value={messageInput}
                    onChange={e => setMessageInput(e.target.value)}
                    className="input flex-1 text-sm"
                    placeholder="Type a message..."
                    maxLength={1600}
                    disabled={sending}
                  />
                  <button type="submit" disabled={sending || !messageInput.trim()} className="btn-primary text-sm px-4">
                    {sending ? '...' : 'Send'}
                  </button>
                </form>
              </>
            )}
          </div>

          {/* Mobile: show thread inline if selected */}
          {selectedPatientId && (
            <div className="sm:hidden fixed inset-0 z-50 bg-white flex flex-col">
              {selectedPatient && (
                <div className="px-4 py-3 border-b bg-slate-50 flex items-center gap-3">
                  <button onClick={() => setSelectedPatientId(null)} className="text-primary-600 font-medium text-sm">&lt; Back</button>
                  <div>
                    <div className="font-semibold text-sm">{selectedPatient.first_name} {selectedPatient.last_name}</div>
                    <div className="text-xs text-slate-500">{selectedPatient.phone}</div>
                  </div>
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                      msg.direction === 'outbound' ? 'bg-primary-600 text-white rounded-br-md' : 'bg-slate-100 text-slate-900 rounded-bl-md'
                    }`}>
                      <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                      <div className={`text-xs mt-1 ${msg.direction === 'outbound' ? 'text-primary-200' : 'text-slate-400'}`}>
                        {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        {msg.direction === 'outbound' && <span className="ml-1">{STATUS_ICONS[msg.status] || ''}</span>}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>
              <form onSubmit={handleSend} className="border-t px-4 py-3 flex gap-2">
                <input value={messageInput} onChange={e => setMessageInput(e.target.value)} className="input flex-1 text-sm" placeholder="Type a message..." maxLength={1600} disabled={sending} />
                <button type="submit" disabled={sending || !messageInput.trim()} className="btn-primary text-sm px-4">{sending ? '...' : 'Send'}</button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Templates tab */}
      {tab === 'templates' && canManage && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold">Message Templates</h2>
            <button onClick={() => { setEditingTemplate(null); setShowTemplateForm(true); }} className="btn-primary text-sm">+ New Template</button>
          </div>

          <div className="bg-slate-50 border rounded-lg p-3 text-sm text-slate-600">
            Available placeholders: <code className="text-xs bg-white px-1 py-0.5 rounded">{'{{first_name}}'}</code> <code className="text-xs bg-white px-1 py-0.5 rounded">{'{{last_name}}'}</code> <code className="text-xs bg-white px-1 py-0.5 rounded">{'{{appointment_date}}'}</code> <code className="text-xs bg-white px-1 py-0.5 rounded">{'{{appointment_time}}'}</code> <code className="text-xs bg-white px-1 py-0.5 rounded">{'{{clinic_name}}'}</code> <code className="text-xs bg-white px-1 py-0.5 rounded">{'{{clinic_phone}}'}</code>
          </div>

          {showTemplateForm && (
            <form onSubmit={handleSaveTemplate} className="card space-y-3">
              <h3 className="font-semibold text-sm">{editingTemplate ? 'Edit Template' : 'New Template'}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Name *</label>
                  <input name="name" required className="input" defaultValue={editingTemplate?.name || ''} placeholder="e.g., Appointment Reminder" />
                </div>
                <div>
                  <label className="label">Type *</label>
                  <select name="templateType" required className="input" defaultValue={editingTemplate?.template_type || 'custom'}>
                    <option value="reminder">Appointment Reminder</option>
                    <option value="birthday">Birthday</option>
                    <option value="follow_up">Follow-up</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Message Body *</label>
                <textarea name="body" required rows={4} className="input" maxLength={1600} defaultValue={editingTemplate?.body || ''} placeholder="Hi {{first_name}}, this is a reminder..." />
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setShowTemplateForm(false); setEditingTemplate(null); }} className="btn-secondary text-sm">Cancel</button>
                <button type="submit" className="btn-primary text-sm">{editingTemplate ? 'Update' : 'Create'}</button>
              </div>
            </form>
          )}

          {loadingTemplates ? (
            <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
          ) : templates.length === 0 ? (
            <div className="card text-center py-8 text-slate-400 text-sm">No templates yet. Create one to get started.</div>
          ) : (
            <div className="space-y-2">
              {templates.map(tmpl => (
                <div key={tmpl.id} className="card">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{tmpl.name}</span>
                        <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                          tmpl.template_type === 'reminder' ? 'bg-blue-100 text-blue-700' :
                          tmpl.template_type === 'birthday' ? 'bg-pink-100 text-pink-700' :
                          tmpl.template_type === 'follow_up' ? 'bg-green-100 text-green-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {tmpl.template_type.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 whitespace-pre-wrap">{tmpl.body}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => useTemplate(tmpl)} className="text-xs text-primary-600 underline">Use</button>
                      <button onClick={() => { setEditingTemplate(tmpl); setShowTemplateForm(true); }} className="text-xs text-slate-500 underline ml-2">Edit</button>
                      <button onClick={() => handleDeleteTemplate(tmpl.id)} className="text-xs text-red-500 underline ml-2">Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
