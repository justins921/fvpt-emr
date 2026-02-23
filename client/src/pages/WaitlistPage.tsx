import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface WaitlistEntry {
  id: string;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  patient_phone: string;
  mrn: string;
  preferred_therapist_id: string | null;
  therapist_first_name: string | null;
  therapist_last_name: string | null;
  preferred_days: string[] | null;
  preferred_time_start: string | null;
  preferred_time_end: string | null;
  urgency: string;
  appointment_type: string;
  status: string;
  notes: string | null;
  contacted_at: string | null;
  contact_notes: string | null;
  created_at: string;
}

interface MatchResult extends WaitlistEntry {}

interface Therapist {
  id: string;
  first_name: string;
  last_name: string;
  credential: string;
}

const URGENCY_COLORS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  normal: 'bg-blue-100 text-blue-800',
  low: 'bg-slate-100 text-slate-600',
};

const STATUS_COLORS: Record<string, string> = {
  waiting: 'badge-yellow',
  contacted: 'badge-blue',
  scheduled: 'badge-green',
  cancelled: 'badge-gray',
  expired: 'badge-red',
};

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export default function WaitlistPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('');
  const [page, setPage] = useState(1);

  // Add form
  const [showForm, setShowForm] = useState(false);
  const [therapists, setTherapists] = useState<Therapist[]>([]);

  // Match
  const [showMatch, setShowMatch] = useState(false);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);

  useEffect(() => { loadEntries(); }, [statusFilter, urgencyFilter, page]);
  useEffect(() => { loadTherapists(); }, []);

  async function loadEntries() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (statusFilter) params.set('status', statusFilter);
      if (urgencyFilter) params.set('urgency', urgencyFilter);
      const res = await api.get<any>(`/waitlist?${params}`);
      setEntries(res.data || []);
      setTotal(res.meta?.total || 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load waitlist');
    } finally { setLoading(false); }
  }

  async function loadTherapists() {
    try {
      const res = await api.get<any>('/users');
      setTherapists((res.data || []).filter((u: any) => u.is_active && u.credential));
    } catch {}
  }

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    const selectedDays = DAYS.filter(d => fd.get(`day_${d}`) === 'on');
    try {
      await api.post('/waitlist', {
        patientId: fd.get('patientId'),
        preferredTherapistId: fd.get('preferredTherapistId') || null,
        preferredDays: selectedDays.length > 0 ? selectedDays : null,
        preferredTimeStart: fd.get('preferredTimeStart') || null,
        preferredTimeEnd: fd.get('preferredTimeEnd') || null,
        urgency: fd.get('urgency'),
        appointmentType: fd.get('appointmentType'),
        notes: fd.get('notes') || null,
      });
      setShowForm(false);
      setSuccess('Patient added to waitlist');
      setTimeout(() => setSuccess(''), 4000);
      loadEntries();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add to waitlist');
    }
  }

  async function handleContact(id: string) {
    const notes = prompt('Contact notes (optional):');
    if (notes === null) return;
    try {
      await api.put(`/waitlist/${id}/contact`, { contactNotes: notes || null });
      setSuccess('Marked as contacted');
      setTimeout(() => setSuccess(''), 4000);
      loadEntries();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update');
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancel this waitlist entry?')) return;
    try {
      await api.delete(`/waitlist/${id}`);
      setSuccess('Entry cancelled');
      setTimeout(() => setSuccess(''), 4000);
      loadEntries();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel');
    }
  }

  async function handleMatch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMatchLoading(true);
    setMatchResults([]);
    const fd = new FormData(e.currentTarget);
    try {
      const params = new URLSearchParams({
        therapist_id: fd.get('matchTherapistId') as string,
        day_of_week: fd.get('matchDay') as string,
        time_start: fd.get('matchTimeStart') as string,
        time_end: fd.get('matchTimeEnd') as string,
      });
      const res = await api.get<any>(`/waitlist/match?${params}`);
      setMatchResults(res.data || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Match failed');
    } finally { setMatchLoading(false); }
  }

  function formatDays(days: string[] | null): string {
    if (!days || days.length === 0) return 'Any';
    return days.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ');
  }

  function formatTime(start: string | null, end: string | null): string {
    if (!start && !end) return 'Any time';
    return `${start || '?'} - ${end || '?'}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900 flex-1">Waitlist</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowMatch(!showMatch)} className="btn-secondary text-sm">
            Find Match
          </button>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">
            + Add to Waitlist
          </button>
        </div>
      </div>

      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}<button onClick={() => setError('')} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Match open slot tool */}
      {showMatch && (
        <form onSubmit={handleMatch} className="card space-y-3">
          <h3 className="font-semibold">Find Patients for Open Slot</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="label">Therapist *</label>
              <select name="matchTherapistId" required className="input">
                <option value="">Select...</option>
                {therapists.map(t => (
                  <option key={t.id} value={t.id}>{t.last_name}, {t.first_name} ({t.credential})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Day *</label>
              <select name="matchDay" required className="input">
                {DAYS.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Start Time *</label>
              <input name="matchTimeStart" type="time" required className="input" />
            </div>
            <div>
              <label className="label">End Time *</label>
              <input name="matchTimeEnd" type="time" required className="input" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowMatch(false); setMatchResults([]); }} className="btn-secondary text-sm">Close</button>
            <button type="submit" disabled={matchLoading} className="btn-primary text-sm">
              {matchLoading ? 'Searching...' : 'Find Matches'}
            </button>
          </div>
          {matchResults.length > 0 && (
            <div className="border-t pt-3 mt-3">
              <h4 className="text-sm font-medium mb-2">{matchResults.length} matching patient(s)</h4>
              <div className="space-y-2">
                {matchResults.map(m => (
                  <div key={m.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{m.patient_last_name}, {m.patient_first_name}</span>
                      <span className="text-slate-500 ml-2">{m.patient_phone || 'No phone'}</span>
                      <span className={`ml-2 inline-block px-2 py-0.5 text-xs rounded-full ${URGENCY_COLORS[m.urgency]}`}>
                        {m.urgency}
                      </span>
                    </div>
                    <button onClick={() => handleContact(m.id)} className="text-xs text-primary-600 underline">Contact</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {matchResults.length === 0 && !matchLoading && (
            <div className="text-sm text-slate-500 text-center py-2">No matches found. Try broader criteria.</div>
          )}
        </form>
      )}

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleAdd} className="card space-y-3">
          <h3 className="font-semibold">Add to Waitlist</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="label">Patient ID *</label>
              <input name="patientId" required className="input" placeholder="Patient UUID" />
            </div>
            <div>
              <label className="label">Appointment Type *</label>
              <select name="appointmentType" required className="input">
                <option value="follow_up">Follow-up</option>
                <option value="evaluation">Evaluation</option>
                <option value="re_evaluation">Re-evaluation</option>
              </select>
            </div>
            <div>
              <label className="label">Urgency *</label>
              <select name="urgency" required className="input">
                <option value="normal">Normal</option>
                <option value="low">Low</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="label">Preferred Therapist</label>
              <select name="preferredTherapistId" className="input">
                <option value="">No preference</option>
                {therapists.map(t => (
                  <option key={t.id} value={t.id}>{t.last_name}, {t.first_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Preferred Time Start</label>
              <input name="preferredTimeStart" type="time" className="input" />
            </div>
            <div>
              <label className="label">Preferred Time End</label>
              <input name="preferredTimeEnd" type="time" className="input" />
            </div>
          </div>
          <div>
            <label className="label">Preferred Days</label>
            <div className="flex flex-wrap gap-3">
              {DAYS.map(d => (
                <label key={d} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name={`day_${d}`} className="rounded" />
                  {d.charAt(0).toUpperCase() + d.slice(1, 3)}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea name="notes" rows={2} className="input" />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Add to Waitlist</button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex gap-2 items-center flex-wrap">
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="input max-w-xs">
          <option value="">All Statuses</option>
          <option value="waiting">Waiting</option>
          <option value="contacted">Contacted</option>
          <option value="scheduled">Scheduled</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </select>
        <select value={urgencyFilter} onChange={e => { setUrgencyFilter(e.target.value); setPage(1); }} className="input max-w-xs">
          <option value="">All Urgency</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <span className="text-sm text-slate-500 ml-auto">{total} entr{total !== 1 ? 'ies' : 'y'}</span>
      </div>

      {/* Waitlist table */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : entries.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No waitlist entries found</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Patient</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Therapist</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Days / Times</th>
                <th className="text-left px-4 py-3">Urgency</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Added</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map(entry => (
                <tr key={entry.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{entry.patient_last_name}, {entry.patient_first_name}</div>
                    <div className="text-xs text-slate-500">{entry.patient_phone || 'No phone'}</div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-slate-600">
                    {entry.therapist_first_name
                      ? `${entry.therapist_last_name}, ${entry.therapist_first_name}`
                      : <span className="text-slate-400">Any</span>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-600">
                    <div>{formatDays(entry.preferred_days)}</div>
                    <div>{formatTime(entry.preferred_time_start, entry.preferred_time_end)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${URGENCY_COLORS[entry.urgency]}`}>
                      {entry.urgency}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={STATUS_COLORS[entry.status] || 'badge-gray'}>{entry.status}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-500">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {entry.status === 'waiting' && (
                        <button onClick={() => handleContact(entry.id)} className="text-xs text-blue-600 underline">Contact</button>
                      )}
                      {(entry.status === 'waiting' || entry.status === 'contacted') && (
                        <button onClick={() => handleCancel(entry.id)} className="text-xs text-red-600 underline">Cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <div className="text-sm text-slate-500">{total} total</div>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-secondary text-sm">Previous</button>
              <button disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)} className="btn-secondary text-sm">Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
