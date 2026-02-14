import { useState, useEffect } from 'react';
import { useParams, Routes, Route, Link, useLocation } from 'react-router-dom';
import { api } from '../services/api';

interface PatientData {
  id: string; mrn: string; first_name: string; last_name: string;
  date_of_birth: string; gender: string; phone: string; email: string;
  primary_diagnosis_icd10: string; secondary_diagnoses_icd10: string[];
  precautions: string; referral_source: string; referring_provider: string;
  address_line1: string; city: string; state: string; zip: string;
  emergency_contact_name: string; emergency_contact_phone: string;
}

const TABS = [
  { path: '', label: 'Overview' },
  { path: 'notes', label: 'Notes' },
  { path: 'schedule', label: 'Schedule' },
  { path: 'billing', label: 'Billing' },
  { path: 'attachments', label: 'Files' },
  { path: 'audit', label: 'Audit' },
];

export default function PatientChartPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [patient, setPatient] = useState<PatientData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) loadPatient();
  }, [id]);

  async function loadPatient() {
    try {
      const res = await api.get<any>(`/patients/${id}`);
      setPatient(res.data);
    } catch { /* handle error */ }
    finally { setLoading(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  if (!patient) return <div className="text-center py-12 text-slate-500">Patient not found</div>;

  const currentTab = location.pathname.split('/').pop() || '';
  const basePath = `/patients/${id}`;

  return (
    <div className="space-y-4">
      {/* Patient header */}
      <div className="card flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-12 h-12 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-lg font-bold">
          {patient.first_name[0]}{patient.last_name[0]}
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{patient.last_name}, {patient.first_name}</h1>
          <div className="text-sm text-slate-500 flex flex-wrap gap-x-4 gap-y-1 mt-1">
            <span>MRN: {patient.mrn}</span>
            <span>DOB: {new Date(patient.date_of_birth).toLocaleDateString()}</span>
            <span className="capitalize">Gender: {patient.gender}</span>
            {patient.primary_diagnosis_icd10 && <span>Dx: {patient.primary_diagnosis_icd10}</span>}
          </div>
        </div>
        {patient.precautions && (
          <div className="badge-red text-sm">⚠ {patient.precautions}</div>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map(tab => {
          const isActive = tab.path === '' 
            ? (currentTab === id || currentTab === '')
            : currentTab === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path ? `${basePath}/${tab.path}` : basePath}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap min-h-touch flex items-center transition-colors ${
                isActive
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* Tab content */}
      <Routes>
        <Route index element={<PatientOverview patient={patient} />} />
        <Route path="notes" element={<PatientNotes patientId={id!} />} />
        <Route path="schedule" element={<PatientSchedule patientId={id!} />} />
        <Route path="billing" element={<PatientBilling patientId={id!} />} />
        <Route path="attachments" element={<PatientAttachments patientId={id!} />} />
        <Route path="audit" element={<PatientAudit patientId={id!} />} />
      </Routes>
    </div>
  );
}

function PatientOverview({ patient }: { patient: PatientData }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card">
        <h3 className="font-semibold mb-3">Demographics</h3>
        <dl className="space-y-2 text-sm">
          <InfoRow label="Phone" value={patient.phone} />
          <InfoRow label="Email" value={patient.email} />
          <InfoRow label="Address" value={[patient.address_line1, patient.city, patient.state, patient.zip].filter(Boolean).join(', ')} />
          <InfoRow label="Emergency Contact" value={patient.emergency_contact_name} />
          <InfoRow label="Emergency Phone" value={patient.emergency_contact_phone} />
        </dl>
      </div>
      <div className="card">
        <h3 className="font-semibold mb-3">Clinical</h3>
        <dl className="space-y-2 text-sm">
          <InfoRow label="Primary Dx" value={patient.primary_diagnosis_icd10} />
          <InfoRow label="Secondary Dx" value={patient.secondary_diagnoses_icd10?.join(', ')} />
          <InfoRow label="Precautions" value={patient.precautions} />
          <InfoRow label="Referral Source" value={patient.referral_source} />
          <InfoRow label="Referring Provider" value={patient.referring_provider} />
        </dl>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex">
      <dt className="w-40 text-slate-500 flex-shrink-0">{label}</dt>
      <dd className="text-slate-900">{value || '-'}</dd>
    </div>
  );
}

function PatientNotes({ patientId }: { patientId: string }) {
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { loadNotes(); }, []);

  async function loadNotes() {
    try {
      const res = await api.get<any>(`/notes/patient/${patientId}`);
      setNotes(res.data || []);
    } catch {} finally { setLoading(false); }
  }

  async function handleCreateNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/notes', {
        patientId,
        noteType: form.get('noteType'),
        subjective: form.get('subjective') || null,
        objective: form.get('objective') || null,
        assessment: form.get('assessment') || null,
        plan: form.get('plan') || null,
        cptCodes: (form.get('cptCodes') as string)?.split(',').map(s => s.trim()).filter(Boolean) || [],
        icd10Codes: (form.get('icd10Codes') as string)?.split(',').map(s => s.trim()).filter(Boolean) || [],
        treatmentTimeMinutes: form.get('treatmentTimeMinutes') ? parseInt(form.get('treatmentTimeMinutes') as string) : null,
      });
      setShowForm(false);
      loadNotes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create note');
    }
  }

  async function signNote(noteId: string) {
    if (!confirm('Sign and finalize this note? This action cannot be undone.')) return;
    try {
      await api.post(`/notes/${noteId}/sign`);
      loadNotes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to sign note');
    }
  }

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Clinical Notes</h3>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">+ New Note</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreateNote} className="card space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Note Type</label>
              <select name="noteType" required className="input">
                <option value="daily_soap">Daily SOAP</option>
                <option value="evaluation">Evaluation</option>
                <option value="progress">Progress Note</option>
                <option value="discharge">Discharge</option>
              </select>
            </div>
            <div>
              <label className="label">CPT Codes (comma sep)</label>
              <input name="cptCodes" placeholder="97110, 97140" className="input" />
            </div>
            <div>
              <label className="label">Treatment Time (min)</label>
              <input name="treatmentTimeMinutes" type="number" className="input" />
            </div>
          </div>
          <div><label className="label">Subjective</label><textarea name="subjective" rows={3} className="input" placeholder="Patient reports..." /></div>
          <div><label className="label">Objective</label><textarea name="objective" rows={3} className="input" placeholder="Observed..." /></div>
          <div><label className="label">Assessment</label><textarea name="assessment" rows={2} className="input" placeholder="Assessment..." /></div>
          <div><label className="label">Plan</label><textarea name="plan" rows={2} className="input" placeholder="Plan..." /></div>
          <div><label className="label">ICD-10 Codes (comma sep)</label><input name="icd10Codes" placeholder="M54.5, M79.3" className="input" /></div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Save Draft</button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {notes.length === 0 ? (
          <div className="card text-center text-slate-500 py-8">No clinical notes yet</div>
        ) : notes.map((note: any) => (
          <div key={note.id} className="card">
            <div className="flex items-start justify-between mb-3">
              <div>
                <span className={`badge ${note.status === 'final' ? 'badge-green' : note.status === 'amended' ? 'badge-yellow' : 'badge-blue'}`}>
                  {note.status}
                </span>
                <span className="ml-2 text-sm font-medium capitalize">{note.note_type.replace('_', ' ')}</span>
                {note.version > 1 && <span className="ml-2 text-xs text-slate-400">v{note.version}</span>}
              </div>
              <div className="text-xs text-slate-400">
                {new Date(note.created_at).toLocaleString()} — {note.author_first_name} {note.author_last_name}
              </div>
            </div>
            {note.subjective && <div className="mb-2"><span className="font-medium text-xs text-slate-500">S:</span> <span className="text-sm">{note.subjective}</span></div>}
            {note.objective && <div className="mb-2"><span className="font-medium text-xs text-slate-500">O:</span> <span className="text-sm">{note.objective}</span></div>}
            {note.assessment && <div className="mb-2"><span className="font-medium text-xs text-slate-500">A:</span> <span className="text-sm">{note.assessment}</span></div>}
            {note.plan && <div className="mb-2"><span className="font-medium text-xs text-slate-500">P:</span> <span className="text-sm">{note.plan}</span></div>}
            {note.cpt_codes?.length > 0 && <div className="text-xs text-slate-500 mt-2">CPT: {note.cpt_codes.join(', ')}</div>}
            {note.status === 'draft' && (
              <div className="mt-3 flex gap-2">
                <button onClick={() => signNote(note.id)} className="btn-primary text-xs">Sign & Finalize</button>
              </div>
            )}
            {note.signed_at && <div className="mt-2 text-xs text-green-600">Signed by {note.signer_first_name} {note.signer_last_name} on {new Date(note.signed_at).toLocaleString()}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PatientSchedule({ patientId }: { patientId: string }) {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const startDate = new Date(Date.now() - 90 * 86400000).toISOString();
        const endDate = new Date(Date.now() + 365 * 86400000).toISOString();
        const res = await api.get<any>(`/scheduling?startDate=${startDate}&endDate=${endDate}`);
        setAppointments((res.data || []).filter((a: any) => a.patient_id === patientId));
      } catch {} finally { setLoading(false); }
    })();
  }, [patientId]);

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

  return (
    <div className="card">
      <h3 className="font-semibold mb-3">Appointments</h3>
      {appointments.length === 0 ? (
        <p className="text-slate-500 text-sm py-4">No appointments found</p>
      ) : (
        <div className="divide-y">
          {appointments.map((a: any) => (
            <div key={a.id} className="py-3 flex items-center gap-4">
              <div className="w-24 text-sm">{new Date(a.start_time).toLocaleDateString()}</div>
              <div className="w-20 text-sm">{new Date(a.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
              <div className="flex-1 text-sm capitalize">{a.appointment_type.replace('_', ' ')}</div>
              <span className={`badge ${a.status === 'completed' ? 'badge-green' : a.status === 'cancelled' ? 'badge-red' : 'badge-gray'}`}>
                {a.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PatientBilling({ patientId }: { patientId: string }) {
  const [ledger, setLedger] = useState<{ entries: any[]; balanceCents: number }>({ entries: [], balanceCents: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<any>(`/billing/ledger/${patientId}`);
        setLedger(res.data || { entries: [], balanceCents: 0 });
      } catch {} finally { setLoading(false); }
    })();
  }, [patientId]);

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Patient Ledger</h3>
          <div className={`text-lg font-bold ${ledger.balanceCents > 0 ? 'text-red-600' : 'text-green-600'}`}>
            Balance: ${(ledger.balanceCents / 100).toFixed(2)}
          </div>
        </div>
        {ledger.entries.length === 0 ? (
          <p className="text-slate-500 text-sm py-4">No ledger entries</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-right px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ledger.entries.map((e: any) => (
                <tr key={e.id}>
                  <td className="px-3 py-2">{new Date(e.posted_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2"><span className={`badge ${e.entry_type === 'charge' ? 'badge-red' : 'badge-green'}`}>{e.entry_type}</span></td>
                  <td className="px-3 py-2">{e.description}</td>
                  <td className="px-3 py-2 text-right font-mono">${(e.amount_cents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PatientAttachments({ patientId }: { patientId: string }) {
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<any>(`/attachments/patient/${patientId}`);
        setAttachments(res.data || []);
      } catch {} finally { setLoading(false); }
    })();
  }, [patientId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('patientId', patientId);
    try {
      await api.upload('/attachments', formData);
      const res = await api.get<any>(`/attachments/patient/${patientId}`);
      setAttachments(res.data || []);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Attachments</h3>
        <label className="btn-primary text-sm cursor-pointer">
          Upload File
          <input type="file" className="hidden" onChange={handleUpload} accept=".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx" />
        </label>
      </div>
      {attachments.length === 0 ? (
        <p className="text-slate-500 text-sm py-4">No attachments</p>
      ) : (
        <div className="divide-y">
          {attachments.map((a: any) => (
            <div key={a.id} className="py-3 flex items-center gap-4">
              <div className="flex-1">
                <div className="text-sm font-medium">{a.original_filename}</div>
                <div className="text-xs text-slate-500">{(a.size_bytes / 1024).toFixed(1)} KB · {a.mime_type} · {new Date(a.created_at).toLocaleDateString()}</div>
              </div>
              <span className={`badge ${a.scan_status === 'clean' ? 'badge-green' : a.scan_status === 'infected' ? 'badge-red' : 'badge-gray'}`}>
                {a.scan_status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PatientAudit({ patientId }: { patientId: string }) {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<any>(`/audit?resourceId=${patientId}&limit=50`);
        setEvents(res.data || []);
      } catch {} finally { setLoading(false); }
    })();
  }, [patientId]);

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

  return (
    <div className="card">
      <h3 className="font-semibold mb-3">Audit Trail</h3>
      {events.length === 0 ? (
        <p className="text-slate-500 text-sm py-4">No audit events</p>
      ) : (
        <div className="divide-y">
          {events.map((e: any) => (
            <div key={e.id} className="py-2 text-sm">
              <span className="text-slate-400 text-xs">{new Date(e.created_at).toLocaleString()}</span>
              <span className="ml-2 font-medium">{e.first_name} {e.last_name}</span>
              <span className="ml-2 badge-gray">{e.action}</span>
              <span className="ml-2 text-slate-500 text-xs">IP: {e.ip_address}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
