import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface TelehealthSession {
  id: string;
  patient_id: string;
  therapist_id: string;
  appointment_id: string | null;
  status: string;
  scheduled_time: string;
  started_at: string | null;
  ended_at: string | null;
  patient_link: string | null;
  provider_link: string | null;
  patient_first_name: string;
  patient_last_name: string;
  therapist_first_name: string;
  therapist_last_name: string;
}

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  mrn: string;
}

interface Provider {
  id: string;
  first_name: string;
  last_name: string;
  credential: string | null;
  role: string;
  is_active: boolean;
}

interface Appointment {
  id: string;
  start_time: string;
  appointment_type: string;
  patient_first_name: string;
  patient_last_name: string;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-green-100 text-green-700',
  completed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-700',
};

export default function TelehealthPage() {
  const { user } = useAuth();

  const [sessions, setSessions] = useState<TelehealthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [creating, setCreating] = useState(false);

  // Form fields
  const [formPatientId, setFormPatientId] = useState('');
  const [formTherapistId, setFormTherapistId] = useState('');
  const [formAppointmentId, setFormAppointmentId] = useState('');
  const [formScheduledTime, setFormScheduledTime] = useState('');

  // Filter
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    loadSessions();
  }, [statusFilter]);

  useEffect(() => {
    if (showForm && patients.length === 0) {
      loadFormData();
    }
  }, [showForm]);

  async function loadSessions() {
    setLoading(true);
    setError('');
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const res = await api.get<any>(`/telehealth/sessions${qs}`);
      setSessions(res.data || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }

  async function loadFormData() {
    try {
      const [patRes, userRes, apptRes] = await Promise.all([
        api.get<any>('/patients?limit=200'),
        api.get<any>('/users'),
        api.get<any>(`/scheduling?startDate=${new Date().toISOString()}&endDate=${new Date(Date.now() + 7 * 86400000).toISOString()}`),
      ]);
      setPatients(patRes.data || []);
      setProviders(
        (userRes.data || []).filter((u: any) =>
          ['therapist', 'owner', 'admin'].includes(u.role) && u.is_active
        )
      );
      setAppointments(apptRes.data || []);
    } catch {}
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formPatientId || !formTherapistId || !formScheduledTime) return;
    setCreating(true);
    setError('');
    try {
      await api.post('/telehealth/sessions', {
        patientId: formPatientId,
        therapistId: formTherapistId,
        appointmentId: formAppointmentId || undefined,
        scheduledTime: formScheduledTime,
      });
      setSuccess('Telehealth session created');
      setShowForm(false);
      resetForm();
      loadSessions();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create session');
    } finally {
      setCreating(false);
    }
  }

  function resetForm() {
    setFormPatientId('');
    setFormTherapistId('');
    setFormAppointmentId('');
    setFormScheduledTime('');
  }

  async function startSession(id: string) {
    setError('');
    try {
      await api.post(`/telehealth/sessions/${id}/start`);
      setSuccess('Session started');
      loadSessions();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start session');
    }
  }

  async function endSession(id: string) {
    setError('');
    try {
      await api.post(`/telehealth/sessions/${id}/end`);
      setSuccess('Session ended');
      loadSessions();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to end session');
    }
  }

  function copyPatientLink(link: string | null) {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setSuccess('Patient link copied to clipboard');
      setTimeout(() => setSuccess(''), 3000);
    }).catch(() => {
      setError('Failed to copy link');
    });
  }

  function formatDateTime(iso: string) {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Telehealth</h1>
          <p className="text-sm text-slate-500 mt-1">Manage virtual therapy sessions</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">
          + New Session
        </button>
      </div>

      {/* Alerts */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Create Session Form */}
      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h3 className="font-semibold">Create Telehealth Session</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Patient *</label>
              <select
                value={formPatientId}
                onChange={e => setFormPatientId(e.target.value)}
                required
                className="input"
              >
                <option value="">Select patient...</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.last_name}, {p.first_name} ({p.mrn})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Therapist *</label>
              <select
                value={formTherapistId}
                onChange={e => setFormTherapistId(e.target.value)}
                required
                className="input"
              >
                <option value="">Select therapist...</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.last_name}, {p.first_name}{p.credential ? ` (${p.credential})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Scheduled Time *</label>
              <input
                type="datetime-local"
                value={formScheduledTime}
                onChange={e => setFormScheduledTime(e.target.value)}
                required
                className="input"
              />
            </div>
            <div>
              <label className="label">Link to Appointment (optional)</label>
              <select
                value={formAppointmentId}
                onChange={e => setFormAppointmentId(e.target.value)}
                className="input"
              >
                <option value="">None</option>
                {appointments.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.patient_last_name}, {a.patient_first_name} - {new Date(a.start_time).toLocaleDateString()} ({a.appointment_type})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? 'Creating...' : 'Create Session'}
            </button>
          </div>
        </form>
      )}

      {/* Filter */}
      <div className="flex gap-2 items-center">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="input max-w-xs"
        >
          <option value="">All Statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Sessions List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : sessions.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">
          No telehealth sessions found
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Patient</th>
                <th className="text-left px-4 py-3">Therapist</th>
                <th className="text-left px-4 py-3">Scheduled</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Duration</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sessions.map(s => {
                const duration = s.started_at && s.ended_at
                  ? Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)
                  : s.started_at
                    ? Math.round((Date.now() - new Date(s.started_at).getTime()) / 60000)
                    : null;

                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">
                      {s.patient_last_name}, {s.patient_first_name}
                    </td>
                    <td className="px-4 py-3">
                      {s.therapist_last_name}, {s.therapist_first_name}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {formatDateTime(s.scheduled_time)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${STATUS_COLORS[s.status] || 'bg-slate-100 text-slate-600'}`}>
                        {s.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {duration !== null ? `${duration} min` : '--'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 flex-wrap">
                        {s.status === 'scheduled' && (
                          <button
                            onClick={() => startSession(s.id)}
                            className="text-xs text-green-600 underline font-medium"
                          >
                            Start
                          </button>
                        )}
                        {s.status === 'in_progress' && (
                          <button
                            onClick={() => endSession(s.id)}
                            className="text-xs text-red-600 underline font-medium"
                          >
                            End
                          </button>
                        )}
                        {s.patient_link && s.status !== 'completed' && (
                          <button
                            onClick={() => copyPatientLink(s.patient_link)}
                            className="text-xs text-primary-600 underline"
                          >
                            Copy Patient Link
                          </button>
                        )}
                        {s.provider_link && s.status === 'in_progress' && (
                          <a
                            href={s.provider_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 underline"
                          >
                            Join
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
