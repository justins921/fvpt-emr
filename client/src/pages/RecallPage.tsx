import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  criteria: { days_since_discharge: number; diagnosis_codes?: string[]; min_visits?: number };
  message_template: string;
  channel: string;
  scheduled_date: string | null;
  status: string;
  created_at: string;
  created_by_first_name: string;
  created_by_last_name: string;
  entry_count: number;
  entry_summary?: {
    total_entries: number;
    pending_count: number;
    sent_count: number;
    delivered_count: number;
    failed_count: number;
    responded_count: number;
  };
}

interface RecallEntry {
  id: string;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  mrn: string;
  status: string;
  contact_phone: string | null;
  contact_email: string | null;
  sent_at: string | null;
  failure_reason: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'badge-gray',
  generated: 'badge-blue',
  sent: 'badge-green',
  completed: 'badge-green',
};

const ENTRY_STATUS_COLORS: Record<string, string> = {
  pending: 'badge-yellow',
  sent: 'badge-blue',
  delivered: 'badge-green',
  failed: 'badge-red',
  responded: 'badge-green',
};

export default function RecallPage() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create form
  const [showForm, setShowForm] = useState(false);

  // Detail view
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [entries, setEntries] = useState<RecallEntry[]>([]);
  const [entriesTotal, setEntriesTotal] = useState(0);
  const [entriesPage, setEntriesPage] = useState(1);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => { loadCampaigns(); }, []);
  useEffect(() => {
    if (selectedCampaign) loadEntries(selectedCampaign.id);
  }, [selectedCampaign?.id, entriesPage]);

  async function loadCampaigns() {
    setLoading(true);
    try {
      const res = await api.get<any>('/recall?limit=50');
      setCampaigns(res.data || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load campaigns');
    } finally { setLoading(false); }
  }

  async function loadCampaignDetail(id: string) {
    try {
      const res = await api.get<any>(`/recall/${id}`);
      setSelectedCampaign(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load campaign');
    }
  }

  async function loadEntries(campaignId: string) {
    setEntriesLoading(true);
    try {
      const res = await api.get<any>(`/recall/${campaignId}/entries?page=${entriesPage}&limit=25`);
      setEntries(res.data || []);
      setEntriesTotal(res.meta?.total || 0);
    } catch {} finally { setEntriesLoading(false); }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    const diagCodes = (fd.get('diagnosisCodes') as string).trim();
    const scheduledDate = fd.get('scheduledDate') as string;
    try {
      await api.post('/recall', {
        name: fd.get('name'),
        description: fd.get('description') || null,
        criteria: {
          days_since_discharge: parseInt(fd.get('daysSinceDischarge') as string, 10),
          diagnosis_codes: diagCodes ? diagCodes.split(',').map(c => c.trim()) : undefined,
          min_visits: fd.get('minVisits') ? parseInt(fd.get('minVisits') as string, 10) : undefined,
        },
        messageTemplate: fd.get('messageTemplate'),
        channel: fd.get('channel'),
        scheduledDate: scheduledDate ? new Date(scheduledDate).toISOString() : null,
      });
      setShowForm(false);
      setSuccess('Campaign created');
      setTimeout(() => setSuccess(''), 4000);
      loadCampaigns();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create campaign');
    }
  }

  async function handleGenerate(id: string) {
    setActionLoading(true);
    setError('');
    try {
      const res = await api.post<any>(`/recall/${id}/generate`);
      const data = res.data;
      setSuccess(`Generated: ${data.entriesCreated} entries created, ${data.entriesSkipped} skipped (${data.matchedPatients} matched)`);
      setTimeout(() => setSuccess(''), 6000);
      loadCampaigns();
      if (selectedCampaign?.id === id) {
        loadCampaignDetail(id);
        loadEntries(id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Generate failed');
    } finally { setActionLoading(false); }
  }

  async function handleSend(id: string) {
    if (!confirm('Send this campaign? Messages will be dispatched to all pending entries.')) return;
    setActionLoading(true);
    setError('');
    try {
      const res = await api.post<any>(`/recall/${id}/send`);
      const data = res.data;
      setSuccess(`Sent: ${data.sent} successful, ${data.failed} failed of ${data.totalProcessed}`);
      setTimeout(() => setSuccess(''), 6000);
      loadCampaigns();
      if (selectedCampaign?.id === id) {
        loadCampaignDetail(id);
        loadEntries(id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Send failed');
    } finally { setActionLoading(false); }
  }

  function openDetail(campaign: Campaign) {
    setEntriesPage(1);
    setEntries([]);
    loadCampaignDetail(campaign.id);
  }

  function closeDetail() {
    setSelectedCampaign(null);
    setEntries([]);
  }

  // Detail view
  if (selectedCampaign) {
    const criteria = typeof selectedCampaign.criteria === 'string'
      ? JSON.parse(selectedCampaign.criteria as any)
      : selectedCampaign.criteria;
    const summary = selectedCampaign.entry_summary;

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={closeDetail} className="text-primary-600 font-medium text-sm hover:underline">&lt; Back</button>
          <h1 className="text-2xl font-bold text-slate-900">{selectedCampaign.name}</h1>
          <span className={STATUS_COLORS[selectedCampaign.status] || 'badge-gray'}>{selectedCampaign.status}</span>
        </div>

        {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}<button onClick={() => setError('')} className="ml-2 underline">dismiss</button></div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <h3 className="font-semibold text-sm mb-2">Details</h3>
            <dl className="text-sm space-y-1">
              {selectedCampaign.description && <div><dt className="text-slate-500 inline">Description:</dt> <dd className="inline">{selectedCampaign.description}</dd></div>}
              <div><dt className="text-slate-500 inline">Channel:</dt> <dd className="inline capitalize">{selectedCampaign.channel}</dd></div>
              <div><dt className="text-slate-500 inline">Created:</dt> <dd className="inline">{new Date(selectedCampaign.created_at).toLocaleDateString()} by {selectedCampaign.created_by_first_name} {selectedCampaign.created_by_last_name}</dd></div>
              {selectedCampaign.scheduled_date && <div><dt className="text-slate-500 inline">Scheduled:</dt> <dd className="inline">{new Date(selectedCampaign.scheduled_date).toLocaleDateString()}</dd></div>}
            </dl>
          </div>
          <div className="card">
            <h3 className="font-semibold text-sm mb-2">Criteria</h3>
            <dl className="text-sm space-y-1">
              <div><dt className="text-slate-500 inline">Days since discharge:</dt> <dd className="inline">{criteria.days_since_discharge}</dd></div>
              {criteria.diagnosis_codes?.length > 0 && <div><dt className="text-slate-500 inline">Diagnosis codes:</dt> <dd className="inline font-mono text-xs">{criteria.diagnosis_codes.join(', ')}</dd></div>}
              {criteria.min_visits && <div><dt className="text-slate-500 inline">Min visits:</dt> <dd className="inline">{criteria.min_visits}</dd></div>}
            </dl>
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold text-sm mb-2">Message Template</h3>
          <p className="text-sm text-slate-600 whitespace-pre-wrap bg-slate-50 rounded p-3">{selectedCampaign.message_template}</p>
        </div>

        {/* Entry summary */}
        {summary && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            <div className="card py-2 text-center"><div className="text-lg font-bold">{summary.total_entries}</div><div className="text-xs text-slate-500">Total</div></div>
            <div className="card py-2 text-center"><div className="text-lg font-bold text-yellow-600">{summary.pending_count}</div><div className="text-xs text-slate-500">Pending</div></div>
            <div className="card py-2 text-center"><div className="text-lg font-bold text-blue-600">{summary.sent_count}</div><div className="text-xs text-slate-500">Sent</div></div>
            <div className="card py-2 text-center"><div className="text-lg font-bold text-green-600">{summary.delivered_count}</div><div className="text-xs text-slate-500">Delivered</div></div>
            <div className="card py-2 text-center"><div className="text-lg font-bold text-red-600">{summary.failed_count}</div><div className="text-xs text-slate-500">Failed</div></div>
            <div className="card py-2 text-center"><div className="text-lg font-bold text-emerald-600">{summary.responded_count}</div><div className="text-xs text-slate-500">Responded</div></div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {(selectedCampaign.status === 'draft' || selectedCampaign.status === 'generated') && (
            <button onClick={() => handleGenerate(selectedCampaign.id)} disabled={actionLoading} className="btn-secondary text-sm">
              {actionLoading ? 'Processing...' : 'Generate Entries'}
            </button>
          )}
          {selectedCampaign.status === 'generated' && (
            <button onClick={() => handleSend(selectedCampaign.id)} disabled={actionLoading} className="btn-primary text-sm">
              {actionLoading ? 'Sending...' : 'Send Campaign'}
            </button>
          )}
        </div>

        {/* Entries table */}
        <h3 className="font-semibold text-sm">Entries ({entriesTotal})</h3>
        {entriesLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
        ) : entries.length === 0 ? (
          <div className="card text-center text-slate-500 py-6 text-sm">No entries yet. Generate entries from the campaign criteria.</div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3">Patient</th>
                  <th className="text-left px-4 py-3">MRN</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Phone</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Email</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.map(entry => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{entry.patient_last_name}, {entry.patient_first_name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{entry.mrn}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-slate-500">{entry.contact_phone || '-'}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-slate-500 text-xs">{entry.contact_email || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={ENTRY_STATUS_COLORS[entry.status] || 'badge-gray'}>{entry.status}</span>
                      {entry.failure_reason && <div className="text-xs text-red-500 mt-0.5">{entry.failure_reason}</div>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-500">
                      {entry.sent_at ? new Date(entry.sent_at).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entriesTotal > 25 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <div className="text-sm text-slate-500">{entriesTotal} total</div>
                <div className="flex gap-2">
                  <button disabled={entriesPage <= 1} onClick={() => setEntriesPage(p => p - 1)} className="btn-secondary text-sm">Previous</button>
                  <button disabled={entriesPage * 25 >= entriesTotal} onClick={() => setEntriesPage(p => p + 1)} className="btn-secondary text-sm">Next</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Campaign list view
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900 flex-1">Recall Campaigns</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">+ New Campaign</button>
      </div>

      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}<button onClick={() => setError('')} className="ml-2 underline">dismiss</button></div>}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-3">
          <h3 className="font-semibold">New Campaign</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Campaign Name *</label>
              <input name="name" required maxLength={255} className="input" placeholder="e.g., Q1 Recall - Low Back Pain" />
            </div>
            <div>
              <label className="label">Channel *</label>
              <select name="channel" required className="input">
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description</label>
              <input name="description" className="input" placeholder="Optional description" />
            </div>
          </div>
          <div className="border-t pt-3">
            <h4 className="text-sm font-medium mb-2">Criteria</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Days Since Discharge *</label>
                <input name="daysSinceDischarge" type="number" required min={1} className="input" placeholder="e.g., 90" />
              </div>
              <div>
                <label className="label">Diagnosis Codes</label>
                <input name="diagnosisCodes" className="input" placeholder="M54.5, M17.11 (comma-separated)" />
              </div>
              <div>
                <label className="label">Min Visits</label>
                <input name="minVisits" type="number" min={1} className="input" placeholder="e.g., 5" />
              </div>
            </div>
          </div>
          <div>
            <label className="label">Message Template *</label>
            <textarea name="messageTemplate" required rows={3} maxLength={2000} className="input"
              placeholder="Hi {{first_name}}, it has been a while since your last visit at {{clinic_name}}. We would love to help you continue your progress. Call us at {{clinic_phone}} to schedule." />
          </div>
          <div>
            <label className="label">Scheduled Date</label>
            <input name="scheduledDate" type="date" className="input max-w-xs" />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create Campaign</button>
          </div>
        </form>
      )}

      {/* Campaign list */}
      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
      ) : campaigns.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No recall campaigns yet. Create one to get started.</div>
      ) : (
        <div className="space-y-2">
          {campaigns.map(c => (
            <div key={c.id} className="card flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => openDetail(c)} className="font-medium text-sm text-primary-600 hover:underline">{c.name}</button>
                  <span className={STATUS_COLORS[c.status] || 'badge-gray'}>{c.status}</span>
                  <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded capitalize">{c.channel}</span>
                </div>
                {c.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{c.description}</p>}
                <div className="flex gap-4 mt-1 text-xs text-slate-400">
                  <span>{c.entry_count} entries</span>
                  <span>Created {new Date(c.created_at).toLocaleDateString()}</span>
                  <span>By {c.created_by_first_name} {c.created_by_last_name}</span>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {(c.status === 'draft' || c.status === 'generated') && (
                  <button onClick={() => handleGenerate(c.id)} disabled={actionLoading} className="btn-secondary text-xs px-3 py-1">Generate</button>
                )}
                {c.status === 'generated' && (
                  <button onClick={() => handleSend(c.id)} disabled={actionLoading} className="btn-primary text-xs px-3 py-1">Send</button>
                )}
                <button onClick={() => openDetail(c)} className="btn-secondary text-xs px-3 py-1">View</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
