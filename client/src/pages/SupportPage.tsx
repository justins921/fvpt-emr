import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface SupportRequest {
  id: string;
  request_type: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  dev_notes: string | null;
  submitted_first: string;
  submitted_last: string;
  submitted_username: string;
  resolved_first: string | null;
  resolved_last: string | null;
  created_at: string;
  resolved_at: string | null;
}

const TYPE_LABELS: Record<string, string> = { support: 'Support', bug: 'Bug Report', feature: 'Feature Request' };
const STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

const STATUS_COLORS: Record<string, string> = {
  open: 'badge-blue',
  in_progress: 'badge-yellow',
  resolved: 'badge-green',
  closed: 'badge-gray',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-slate-400',
  normal: 'text-slate-600',
  high: 'text-amber-600 font-medium',
  urgent: 'text-red-600 font-bold',
};

// Check styles for badges that might not exist — define inline fallbacks
function badgeClass(key: string, map: Record<string, string>) {
  return map[key] || 'badge-gray';
}

export default function SupportPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const canManage = ['owner', 'admin', 'dev'].includes(user?.role || '');

  useEffect(() => { loadRequests(); }, []);

  async function loadRequests() {
    try {
      const res = await api.get<any>('/support');
      setRequests(res.data || []);
    } catch {} finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    try {
      await api.post('/support', {
        requestType: fd.get('requestType'),
        subject: fd.get('subject'),
        description: fd.get('description'),
        priority: fd.get('priority'),
      });
      setSuccess('Your request has been submitted.');
      setShowForm(false);
      loadRequests();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit');
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await api.patch(`/support/${id}`, { status });
      loadRequests();
    } catch {}
  }

  async function handleSaveNotes(id: string, devNotes: string) {
    try {
      await api.patch(`/support/${id}`, { devNotes });
      setEditingId(null);
      loadRequests();
    } catch {}
  }

  async function handlePriorityChange(id: string, priority: string) {
    try {
      await api.patch(`/support/${id}`, { priority });
      loadRequests();
    } catch {}
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Support</h1>
          <p className="text-sm text-slate-500 mt-1">
            {canManage ? 'Manage support requests, bug reports, and feature requests' : 'Request support, report bugs, or suggest features'}
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">
          + New Request
        </button>
      </div>

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Submit form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h3 className="font-semibold">Submit a Request</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Type *</label>
              <select name="requestType" required className="input">
                <option value="support">Support Request</option>
                <option value="bug">Bug Report</option>
                <option value="feature">Feature Request</option>
              </select>
            </div>
            <div>
              <label className="label">Priority</label>
              <select name="priority" className="input" defaultValue="normal">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Subject *</label>
            <input name="subject" required maxLength={255} className="input" placeholder="Brief summary of your request" />
          </div>
          <div>
            <label className="label">Description *</label>
            <textarea
              name="description"
              required
              rows={5}
              maxLength={5000}
              className="input"
              placeholder="Provide as much detail as possible..."
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Submit Request</button>
          </div>
        </form>
      )}

      {/* Requests list */}
      {requests.length === 0 ? (
        <div className="card text-center py-12 text-slate-400">
          No support requests yet. Click "New Request" to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(req => (
            <div key={req.id} className="card">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                      req.request_type === 'bug' ? 'bg-red-100 text-red-700' :
                      req.request_type === 'feature' ? 'bg-purple-100 text-purple-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {TYPE_LABELS[req.request_type] || req.request_type}
                    </span>
                    <span className={badgeClass(req.status, STATUS_COLORS)}>
                      {STATUS_LABELS[req.status] || req.status}
                    </span>
                    <span className={`text-xs ${PRIORITY_COLORS[req.priority] || ''}`}>
                      {PRIORITY_LABELS[req.priority] || req.priority}
                    </span>
                  </div>
                  <h3 className="font-medium text-slate-900">{req.subject}</h3>
                  <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{req.description}</p>
                  <div className="text-xs text-slate-400 mt-2">
                    Submitted by {req.submitted_first} {req.submitted_last} on {new Date(req.created_at).toLocaleDateString()}
                    {req.resolved_at && (
                      <span> · Resolved by {req.resolved_first} {req.resolved_last} on {new Date(req.resolved_at).toLocaleDateString()}</span>
                    )}
                  </div>

                  {/* Dev notes display */}
                  {req.dev_notes && !canManage && (
                    <div className="mt-3 bg-slate-50 rounded-lg p-3">
                      <div className="text-xs font-medium text-slate-500 mb-1">Developer Response</div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{req.dev_notes}</p>
                    </div>
                  )}

                  {/* Dev management controls */}
                  {canManage && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div>
                          <label className="text-xs text-slate-400">Status</label>
                          <select
                            value={req.status}
                            onChange={e => handleStatusChange(req.id, e.target.value)}
                            className="input text-xs py-1 ml-1"
                          >
                            <option value="open">Open</option>
                            <option value="in_progress">In Progress</option>
                            <option value="resolved">Resolved</option>
                            <option value="closed">Closed</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Priority</label>
                          <select
                            value={req.priority}
                            onChange={e => handlePriorityChange(req.id, e.target.value)}
                            className="input text-xs py-1 ml-1"
                          >
                            <option value="low">Low</option>
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                          </select>
                        </div>
                      </div>

                      {/* Dev notes editor */}
                      {editingId === req.id ? (
                        <div>
                          <label className="text-xs text-slate-400">Developer Notes</label>
                          <textarea
                            id={`notes-${req.id}`}
                            defaultValue={req.dev_notes || ''}
                            rows={3}
                            className="input text-sm mt-1"
                            placeholder="Add notes or a response..."
                          />
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => {
                                const el = document.getElementById(`notes-${req.id}`) as HTMLTextAreaElement;
                                handleSaveNotes(req.id, el.value);
                              }}
                              className="btn-primary text-xs"
                            >Save Notes</button>
                            <button onClick={() => setEditingId(null)} className="btn-secondary text-xs">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          {req.dev_notes && (
                            <div className="bg-slate-50 rounded p-2 mb-2">
                              <div className="text-xs font-medium text-slate-500 mb-1">Dev Notes</div>
                              <p className="text-sm text-slate-700 whitespace-pre-wrap">{req.dev_notes}</p>
                            </div>
                          )}
                          <button onClick={() => setEditingId(req.id)} className="text-xs text-primary-600 underline">
                            {req.dev_notes ? 'Edit Notes' : 'Add Notes'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
