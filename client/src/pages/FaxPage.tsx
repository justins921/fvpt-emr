import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface Fax {
  id: string;
  direction: 'inbound' | 'outbound';
  status: string;
  fax_number: string;
  patient_id: string | null;
  patient_first_name: string | null;
  patient_last_name: string | null;
  subject: string | null;
  document_type: string | null;
  pages: number | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
}

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  mrn: string;
  referring_provider_fax: string | null;
  referring_provider_name: string | null;
}

const STATUS_BADGES: Record<string, string> = {
  queued: 'bg-yellow-100 text-yellow-700',
  sending: 'bg-blue-100 text-blue-700',
  sent: 'bg-green-100 text-green-700',
  delivered: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  received: 'bg-blue-100 text-blue-700',
  reviewed: 'bg-slate-100 text-slate-600',
};

const DOCUMENT_TYPES = [
  'referral',
  'progress_note',
  'eval_report',
  'plan_of_care',
  'discharge_summary',
  'medical_records',
  'insurance_auth',
  'other',
];

export default function FaxPage() {
  const { user } = useAuth();

  const [faxes, setFaxes] = useState<Fax[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [directionFilter, setDirectionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Send form
  const [showSendForm, setShowSendForm] = useState(false);
  const [showQuickFax, setShowQuickFax] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [sending, setSending] = useState(false);

  // Send form fields
  const [faxNumber, setFaxNumber] = useState('');
  const [documentType, setDocumentType] = useState('progress_note');
  const [faxPatientId, setFaxPatientId] = useState('');
  const [faxSubject, setFaxSubject] = useState('');
  const [faxNote, setFaxNote] = useState('');

  // Quick fax fields
  const [quickPatientId, setQuickPatientId] = useState('');
  const [quickDocType, setQuickDocType] = useState('progress_note');
  const [quickNote, setQuickNote] = useState('');

  useEffect(() => {
    loadFaxes();
  }, [directionFilter, statusFilter]);

  useEffect(() => {
    if ((showSendForm || showQuickFax) && patients.length === 0) {
      loadPatients();
    }
  }, [showSendForm, showQuickFax]);

  async function loadFaxes() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (directionFilter) params.set('direction', directionFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await api.get<any>(`/fax?${params.toString()}`);
      setFaxes(res.data || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load faxes');
    } finally {
      setLoading(false);
    }
  }

  async function loadPatients() {
    try {
      const res = await api.get<any>('/patients?limit=200');
      setPatients(res.data || []);
    } catch {}
  }

  async function handleSendFax(e: React.FormEvent) {
    e.preventDefault();
    if (!faxNumber.trim()) return;
    setSending(true);
    setError('');
    try {
      await api.post('/fax/send', {
        faxNumber: faxNumber.trim(),
        documentType,
        patientId: faxPatientId || undefined,
        subject: faxSubject.trim() || undefined,
        note: faxNote.trim() || undefined,
      });
      setSuccess('Fax queued for delivery');
      setShowSendForm(false);
      resetSendForm();
      loadFaxes();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send fax');
    } finally {
      setSending(false);
    }
  }

  async function handleQuickFax(e: React.FormEvent) {
    e.preventDefault();
    if (!quickPatientId) return;
    const patient = patients.find(p => p.id === quickPatientId);
    if (!patient?.referring_provider_fax) {
      setError('Selected patient does not have a referring provider fax number on file');
      return;
    }
    setSending(true);
    setError('');
    try {
      await api.post('/fax/send', {
        faxNumber: patient.referring_provider_fax,
        documentType: quickDocType,
        patientId: quickPatientId,
        subject: `${quickDocType.replace(/_/g, ' ')} for ${patient.last_name}, ${patient.first_name}`,
        note: quickNote.trim() || undefined,
      });
      setSuccess(`Fax queued to ${patient.referring_provider_name || 'referring provider'} at ${patient.referring_provider_fax}`);
      setShowQuickFax(false);
      resetQuickForm();
      loadFaxes();
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send fax');
    } finally {
      setSending(false);
    }
  }

  function resetSendForm() {
    setFaxNumber('');
    setDocumentType('progress_note');
    setFaxPatientId('');
    setFaxSubject('');
    setFaxNote('');
  }

  function resetQuickForm() {
    setQuickPatientId('');
    setQuickDocType('progress_note');
    setQuickNote('');
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString() + ' ' +
      new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  const selectedQuickPatient = patients.find(p => p.id === quickPatientId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Fax Management</h1>
          <p className="text-sm text-slate-500 mt-1">Send and receive faxes for patient records</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowQuickFax(!showQuickFax); setShowSendForm(false); }} className="btn-secondary text-sm">
            Quick Fax to Referrer
          </button>
          <button onClick={() => { setShowSendForm(!showSendForm); setShowQuickFax(false); }} className="btn-primary text-sm">
            + Send Fax
          </button>
        </div>
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

      {/* Quick Fax to Referring Provider */}
      {showQuickFax && (
        <form onSubmit={handleQuickFax} className="card space-y-4">
          <h3 className="font-semibold">Quick Fax to Referring Provider</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Patient *</label>
              <select
                value={quickPatientId}
                onChange={e => setQuickPatientId(e.target.value)}
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
              {selectedQuickPatient && (
                <div className="text-xs text-slate-500 mt-1">
                  {selectedQuickPatient.referring_provider_name
                    ? `Referring: ${selectedQuickPatient.referring_provider_name} - ${selectedQuickPatient.referring_provider_fax || 'No fax #'}`
                    : 'No referring provider on file'}
                </div>
              )}
            </div>
            <div>
              <label className="label">Document Type *</label>
              <select value={quickDocType} onChange={e => setQuickDocType(e.target.value)} className="input">
                {DOCUMENT_TYPES.map(t => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Note (optional)</label>
              <textarea
                value={quickNote}
                onChange={e => setQuickNote(e.target.value)}
                className="input"
                rows={2}
                placeholder="Additional notes for the fax cover sheet..."
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowQuickFax(false); resetQuickForm(); }} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={sending} className="btn-primary">
              {sending ? 'Sending...' : 'Send Quick Fax'}
            </button>
          </div>
        </form>
      )}

      {/* Send Fax Form */}
      {showSendForm && (
        <form onSubmit={handleSendFax} className="card space-y-4">
          <h3 className="font-semibold">Send Fax</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="label">Fax Number *</label>
              <input
                type="tel"
                value={faxNumber}
                onChange={e => setFaxNumber(e.target.value)}
                required
                className="input"
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <label className="label">Document Type *</label>
              <select value={documentType} onChange={e => setDocumentType(e.target.value)} className="input">
                {DOCUMENT_TYPES.map(t => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Patient (optional)</label>
              <select value={faxPatientId} onChange={e => setFaxPatientId(e.target.value)} className="input">
                <option value="">None</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.last_name}, {p.first_name} ({p.mrn})
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label">Subject (optional)</label>
              <input
                type="text"
                value={faxSubject}
                onChange={e => setFaxSubject(e.target.value)}
                className="input"
                placeholder="Fax subject / cover sheet title"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label">Note (optional)</label>
              <textarea
                value={faxNote}
                onChange={e => setFaxNote(e.target.value)}
                className="input"
                rows={3}
                placeholder="Additional note for the fax cover sheet..."
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowSendForm(false); resetSendForm(); }} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={sending} className="btn-primary">
              {sending ? 'Sending...' : 'Send Fax'}
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex gap-2 items-center flex-wrap">
        <select
          value={directionFilter}
          onChange={e => setDirectionFilter(e.target.value)}
          className="input max-w-xs"
        >
          <option value="">All Directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="input max-w-xs"
        >
          <option value="">All Statuses</option>
          <option value="queued">Queued</option>
          <option value="sending">Sending</option>
          <option value="sent">Sent</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
          <option value="received">Received</option>
          <option value="reviewed">Reviewed</option>
        </select>
      </div>

      {/* Fax List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : faxes.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No faxes found</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Direction</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Fax Number</th>
                <th className="text-left px-4 py-3">Patient</th>
                <th className="text-left px-4 py-3">Subject</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-right px-4 py-3">Pages</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {faxes.map(f => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    {f.direction === 'inbound' ? (
                      <span className="inline-flex items-center text-blue-600 text-xs font-medium">
                        <span className="mr-1">&#8595;</span> In
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-green-600 text-xs font-medium">
                        <span className="mr-1">&#8593;</span> Out
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${STATUS_BADGES[f.status] || 'bg-slate-100 text-slate-600'}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{f.fax_number}</td>
                  <td className="px-4 py-3">
                    {f.patient_last_name
                      ? `${f.patient_last_name}, ${f.patient_first_name}`
                      : <span className="text-slate-400">--</span>}
                  </td>
                  <td className="px-4 py-3 text-xs max-w-[200px] truncate">
                    {f.subject || <span className="text-slate-400">--</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {f.document_type ? f.document_type.replace(/_/g, ' ') : '--'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatDate(f.sent_at || f.received_at || f.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">
                    {f.pages ?? '--'}
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
