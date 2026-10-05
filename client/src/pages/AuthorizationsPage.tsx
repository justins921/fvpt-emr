import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const Spinner = () => (
  <div className="flex justify-center py-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
  </div>
);

/** Format a YYYY-MM-DD date string without timezone shift (new Date('2027-01-05') parses as UTC). */
function fmtDateOnly(s: string | null | undefined): string {
  if (!s) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (m) return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString();
}

const EMPTY_AUTH = {
  patient_id: '', insurance_id: '', auth_number: '', service_type: 'PT',
  visits_authorized: '', visits_used: '0', start_date: '', end_date: '', status: 'draft', notes: '',
  follow_up_date: '', denial_reason: '',
};

const WORKFLOW_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'pending', label: 'Pending Payer' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'expired', label: 'Expired' },
  { value: 'active', label: 'Active' },
  { value: 'exhausted', label: 'Exhausted' },
  { value: 'cancelled', label: 'Cancelled' },
];

const EMPTY_PAYER = {
  payer_name: '', requires_auth_for_pt: 'yes', typical_visit_limit: '',
  required_fields: '', submission_notes: '', phone: '', portal_url: '',
};

/** Unwrap API responses — new endpoints may return payload at top level or under `data`. */
function unwrap(res: any) {
  if (!res) return {};
  return res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : res;
}

function urgencyColor(auth: any): string {
  const remaining = (auth.authorized_visits || 0) - (auth.used_visits || 0);
  const daysLeft = auth.end_date ? Math.ceil((new Date(auth.end_date).getTime() - Date.now()) / 86400000) : 999;
  if (auth.status === 'expired' || auth.status === 'denied') return 'border-l-4 border-l-red-500';
  if (remaining <= 2 || daysLeft <= 7) return 'border-l-4 border-l-red-400';
  if (remaining <= 5 || daysLeft <= 14) return 'border-l-4 border-l-yellow-400';
  return '';
}

export default function AuthorizationsPage() {
  const { user } = useAuth();
  const [auths, setAuths] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_AUTH });
  const [patients, setPatients] = useState<any[]>([]);
  const [insurances, setInsurances] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [followupCount, setFollowupCount] = useState(0);
  const [followupItems, setFollowupItems] = useState<any[]>([]);
  const [packetModal, setPacketModal] = useState<{ auth: any; packet: any } | null>(null);
  const [packetLoading, setPacketLoading] = useState<string | null>(null);

  useEffect(() => { loadAuths(); loadPatients(); }, [statusFilter]);
  useEffect(() => { loadFollowups(); }, []);

  async function loadAuths() {
    setLoading(true);
    try {
      const query = statusFilter === '__followup'
        ? `/authorizations?limit=200&needs_followup=true`
        : `/authorizations?limit=200${statusFilter ? `&status=${statusFilter}` : ''}`;
      const res = await api.get<any>(query);
      setAuths(res.data || []);
    } catch { setError('Failed to load authorizations'); } finally { setLoading(false); }
  }

  async function loadPatients() {
    try { const res = await api.get<any>('/patients?limit=500'); setPatients(res.data || []); } catch {}
  }

  async function loadFollowups() {
    try {
      const res = await api.get<any>('/authorizations/alerts/pending-followups');
      const d = unwrap(res);
      setFollowupCount(d.count || 0);
      setFollowupItems(d.items || []);
    } catch { /* follow-up alerts are optional */ }
  }

  function openCreate() {
    setEditing(null); setForm({ ...EMPTY_AUTH }); setInsurances([]); setShowForm(true); setError(''); setSuccess('');
  }

  function openEdit(a: any) {
    setEditing(a);
    loadInsurances(a.patient_id);
    setForm({
      patient_id: a.patient_id || '', insurance_id: a.insurance_id || '',
      auth_number: a.authorization_number || '', service_type: a.service_type || 'PT',
      visits_authorized: String(a.authorized_visits ?? a.visits_authorized ?? ''), visits_used: String(a.used_visits ?? 0),
      start_date: a.start_date?.substring(0, 10) || '', end_date: a.end_date?.substring(0, 10) || '',
      status: a.workflow_status || a.status || 'draft', notes: a.notes || '',
      follow_up_date: a.follow_up_date?.substring(0, 10) || '', denial_reason: a.denial_reason || '',
    });
    setShowForm(true); setError(''); setSuccess('');
  }

  async function loadInsurances(patientId: string) {
    if (!patientId) { setInsurances([]); return; }
    try {
      const res = await api.get<any>(`/patients/${patientId}/insurance`);
      const rows = Array.isArray(res.data) ? res.data : [];
      // Dedupe by id in case of overlapping loads
      const seen = new Set<string>();
      setInsurances(rows.filter((i: any) => {
        if (!i || !i.id || seen.has(i.id)) return false;
        seen.add(i.id);
        return true;
      }));
    } catch { setInsurances([]); }
  }

  function setPatient(patientId: string) {
    setForm(f => ({ ...f, patient_id: patientId, insurance_id: '' }));
    loadInsurances(patientId);
  }

  /** Turn a zod error detail array into human-readable per-field messages. */
  function formatFieldErrors(details: unknown): string {
    if (!Array.isArray(details)) return '';
    const label: Record<string, string> = {
      patient_id: 'Patient', insurance_id: 'Insurance',
      authorization_number: 'Auth number', authorized_visits: 'Visits authorized',
      start_date: 'Start date', end_date: 'End date', notes: 'Notes',
      follow_up_date: 'Follow-up date', denial_reason: 'Denial reason', status: 'Status',
    };
    const plainMessage = (raw: string, field: string): string => {
      if (/expected string, received null/i.test(raw) || /expected string, received undefined/i.test(raw))
        return `${label[field] || field}: this field is required`;
      if (/expected number/i.test(raw)) return `${label[field] || field}: enter a valid number`;
      if (/invalid enum value/i.test(raw)) return `${label[field] || field}: select a valid option`;
      if (/invalid string/i.test(raw) || /invalid date/i.test(raw)) return `${label[field] || field}: enter a valid value`;
      return `${label[field] || field}: ${raw}`;
    };
    return details.map((d: any) => {
      const field = Array.isArray(d.path) ? d.path.join('.') : String(d.path || 'field');
      return plainMessage(String(d.message || 'invalid value'), field);
    }).join(' ');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    // Client-side pre-validation with specific messages (avoids opaque server rejections)
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(form.patient_id)) { setError('Please select a patient.'); return; }
    if (!uuidRe.test(form.insurance_id)) { setError('Please select an insurance — the list loads after you pick a patient. If it shows "No insurance on file", add the patient\'s insurance first.'); return; }
    const visits = Number(form.visits_authorized);
    if (!Number.isInteger(visits) || visits < 1) { setError('Visits authorized must be a whole number of 1 or more.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.start_date)) { setError('Start date must be a valid date (YYYY-MM-DD).'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.end_date)) { setError('End date must be a valid date (YYYY-MM-DD).'); return; }
    if (form.end_date <= form.start_date) { setError('End date must be after start date.'); return; }
    const payload: any = {
      patient_id: form.patient_id,
      insurance_id: form.insurance_id,
      authorization_number: form.auth_number.trim() || null,
      authorized_visits: visits,
      start_date: form.start_date,
      end_date: form.end_date,
      notes: form.notes.trim() || null,
      // The create form's Status dropdown maps to the workflow column
      workflow_status: ['draft', 'submitted', 'pending', 'approved', 'denied', 'expired'].includes(form.status)
        ? form.status
        : 'draft',
    };
    // Edit mode supports the wider update schema — status maps to the workflow column
    if (editing) {
      payload.workflow_status = form.status;
      delete payload.status;
      const used = Number(form.visits_used);
      if (!Number.isInteger(used) || used < 0) { setError('Visits used must be a whole number of 0 or more.'); return; }
      payload.used_visits = used;
      if (form.follow_up_date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(form.follow_up_date)) {
          setError('Follow-up date must be in YYYY-MM-DD format.');
          return;
        }
        payload.follow_up_date = form.follow_up_date;
      }
      if (form.denial_reason.trim()) payload.denial_reason = form.denial_reason.trim();
    }
    try {
      if (editing) { await api.put(`/authorizations/${editing.id}`, payload); setSuccess('Authorization updated'); }
      else { await api.post('/authorizations', payload); setSuccess('Authorization created'); }
      setShowForm(false); loadAuths(); loadFollowups();
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        const msg = formatFieldErrors(err.details);
        setError(msg || err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Save failed');
      }
    }
  }

  async function generatePacket(a: any) {
    setPacketLoading(a.id); setError('');
    try {
      const res = await api.post<any>(`/authorizations/${a.id}/packet`);
      const d = unwrap(res);
      const packet = (d as any).packet || d;
      if (!packet || typeof packet !== 'object' || !packet.authorization) {
        setError('Packet generated but the response was missing authorization data. Please try again.');
        return;
      }
      setPacketModal({ auth: a, packet });
      loadAuths(); loadFollowups();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Packet generation failed'); }
    finally { setPacketLoading(null); }
  }

  const set = (field: string, val: string) => setForm(f => ({ ...f, [field]: val }));

  // Compute alerts
  const alerts = auths.filter(a => {
    if (a.status !== 'active') return false;
    const remaining = (a.authorized_visits || 0) - (a.used_visits || 0);
    const daysLeft = a.end_date ? Math.ceil((new Date(a.end_date).getTime() - Date.now()) / 86400000) : 999;
    return remaining <= 3 || daysLeft <= 14;
  });

  const STATUS_BADGE: Record<string, string> = {
    active: 'badge-green', approved: 'badge-green', submitted: 'badge-blue', pending: 'badge-yellow',
    expired: 'badge-red', denied: 'badge-red', exhausted: 'badge-yellow', cancelled: 'badge-gray', draft: 'badge-gray',
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Authorization Tracking</h1>
        <button onClick={openCreate} className="btn-primary text-sm">+ New Authorization</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">{success}</div>}

      {followupCount > 0 && (
        <div className="bg-orange-50 border border-orange-300 rounded p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-orange-800">
              ⚠ {followupCount} authorization{followupCount === 1 ? '' : 's'} need{followupCount === 1 ? 's' : ''} follow-up
            </h3>
            <button onClick={() => setStatusFilter('__followup')} className="text-sm text-orange-700 underline">
              View follow-ups
            </button>
          </div>
          <div className="mt-2 space-y-1">
            {followupItems.slice(0, 5).map((a: any) => (
              <div key={a.id} className="text-sm flex justify-between items-center">
                <span>
                  <span className="font-medium">{a.patient_last_name}, {a.patient_first_name}</span>
                  <span className="text-slate-500 ml-2">({a.insurance_name})</span>
                </span>
                {a.follow_up_date && (
                  <span className="text-orange-700">Due {fmtDateOnly(a.follow_up_date)}</span>
                )}
              </div>
            ))}
            {followupItems.length > 5 && (
              <div className="text-xs text-slate-500">+{followupItems.length - 5} more</div>
            )}
          </div>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4">
          <h3 className="font-semibold text-amber-800 mb-2">Alerts ({alerts.length})</h3>
          <div className="space-y-1">
            {alerts.map((a: any) => {
              const remaining = (a.authorized_visits || 0) - (a.used_visits || 0);
              const daysLeft = a.end_date ? Math.ceil((new Date(a.end_date).getTime() - Date.now()) / 86400000) : null;
              return (
                <div key={a.id} className="text-sm flex justify-between items-center">
                  <span>
                    <span className="font-medium">{a.patient_last_name}, {a.patient_first_name}</span>
                    <span className="text-slate-500 ml-2">({a.insurance_name})</span>
                  </span>
                  <span className="flex gap-3">
                    {remaining <= 3 && <span className="text-red-600 font-medium">{remaining} visits left</span>}
                    {daysLeft !== null && daysLeft <= 14 && <span className="text-amber-700 font-medium">Expires in {daysLeft}d</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <h3 className="sm:col-span-2 lg:col-span-3 font-semibold">{editing ? 'Edit Authorization' : 'New Authorization'}</h3>
          <div>
            <label className="label">Patient *</label>
            <select value={form.patient_id} onChange={e => setPatient(e.target.value)} required className="input">
              <option value="">Select patient...</option>
              {patients.map((p: any) => <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Insurance *</label>
            <select value={form.insurance_id} onChange={e => set('insurance_id', e.target.value)} required className="input" disabled={!form.patient_id}>
              <option value="">{form.patient_id ? (insurances.length === 0 ? 'No insurance on file' : 'Select insurance...') : 'Select patient first...'}</option>
              {insurances.map((i: any) => (
                <option key={i.id} value={i.id}>
                  {i.payer_name}{i.plan_name ? ` — ${i.plan_name}` : ''}{i.member_id ? ` (${i.member_id})` : ''}{i.is_primary ? ' [primary]' : ''}
                </option>
              ))}
            </select>
          </div>
          <div><label className="label">Auth Number</label><input value={form.auth_number} onChange={e => set('auth_number', e.target.value)} className="input" /></div>
          <div>
            <label className="label">Service Type</label>
            <select value={form.service_type} onChange={e => set('service_type', e.target.value)} className="input">
              <option value="PT">Physical Therapy</option><option value="OT">Occupational Therapy</option>
              <option value="SLP">Speech Therapy</option>
            </select>
          </div>
          <div><label className="label">Visits Authorized *</label><input type="number" min="1" value={form.visits_authorized} onChange={e => set('visits_authorized', e.target.value)} required className="input" /></div>
          {editing && (<div><label className="label">Visits Used</label><input type="number" min="0" value={form.visits_used} onChange={e => set('visits_used', e.target.value)} className="input" /></div>)}
          <div><label className="label">Start Date *</label><input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} required className="input" /></div>
          <div><label className="label">End Date *</label><input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} required className="input" /></div>
          <div>
            <label className="label">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)} className="input">
              {WORKFLOW_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Follow-up Date</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="YYYY-MM-DD"
              pattern="\d{4}-\d{2}-\d{2}"
              title="Enter date as YYYY-MM-DD"
              value={form.follow_up_date}
              onChange={e => set('follow_up_date', e.target.value)}
              className="input"
            />
          </div>
          {form.status === 'denied' && (
            <div><label className="label">Denial Reason</label><input value={form.denial_reason} onChange={e => set('denial_reason', e.target.value)} className="input" placeholder="Reason from payer..." /></div>
          )}
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="label">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="input" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? 'Update' : 'Create'}</button>
          </div>
        </form>
      )}

      <div className="flex gap-2">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input max-w-xs">
          <option value="">All Statuses</option>
          <option value="__followup">⚠ Needs follow-up</option>
          {WORKFLOW_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {loading ? <Spinner /> : auths.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No authorizations found</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Patient</th>
                <th className="text-left px-4 py-3">Insurance</th>
                <th className="text-left px-4 py-3">Visits</th>
                <th className="text-left px-4 py-3">Expires</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {auths.map((a: any) => {
                const used = a.used_visits ?? 0;
                const total = a.authorized_visits ?? 0;
                const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
                const displayStatus = a.workflow_status || a.status;
                return (
                  <tr key={a.id} className={`hover:bg-slate-50 ${urgencyColor(a)}`}>
                    <td className="px-4 py-3 font-medium">{a.patient_last_name}, {a.patient_first_name}</td>
                    <td className="px-4 py-3">{a.insurance_name}</td>
                    <td className="px-4 py-3 w-48">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-200 rounded-full h-2">
                          <div className={`h-2 rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-mono whitespace-nowrap">{used}/{total}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{fmtDateOnly(a.end_date)}</td>
                    <td className="px-4 py-3"><span className={STATUS_BADGE[displayStatus] || 'badge-gray'}>{displayStatus}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(a)} className="text-xs text-primary-600 underline">Edit</button>
                          <button
                            onClick={() => generatePacket(a)}
                            disabled={packetLoading === a.id}
                            className="text-xs text-green-700 underline disabled:text-slate-400"
                          >
                            {packetLoading === a.id ? 'Generating...' : 'Generate Packet'}
                          </button>
                        </div>
                        {a.packet_generated_at && (
                          <span className="text-xs text-slate-400">
                            Packet generated {new Date(a.packet_generated_at).toLocaleDateString()}
                          </span>
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

      {packetModal && <PacketModal auth={packetModal.auth} packet={packetModal.packet} onClose={() => setPacketModal(null)} />}

      <PayerRequirementsSection user={user} />
    </div>
  );
}

// ── Authorization Packet (print-friendly modal) ──

function patientName(patient: any, auth: any): string {
  const p = patient || {};
  const last = p.last_name || auth?.patient_last_name || '';
  const first = p.first_name || auth?.patient_first_name || '';
  if (!last && !first) return p.patient_name || '-';
  return `${last}${last && first ? ', ' : ''}${first}`;
}

function PacketModal({ auth, packet, onClose }: { auth: any; packet: any; onClose: () => void }) {
  const p = packet || {};
  const patient = p.patient || {};
  const insurance = p.insurance || {};
  const authorization = p.authorization || auth || {};
  const dxCodes = p.diagnosisCodes || p.diagnosis_codes || [];

  function PacketSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div className="mb-5">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-slate-500 border-b pb-1 mb-2">{title}</h3>
        <div className="text-sm">{children}</div>
      </div>
    );
  }

  function Row({ label, value }: { label: string; value: any }) {
    if (value === undefined || value === null || value === '') return null;
    return (
      <div className="flex py-0.5">
        <dt className="w-40 text-slate-500 flex-shrink-0">{label}</dt>
        <dd className="text-slate-900">{String(value)}</dd>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 overflow-y-auto p-4 packet-overlay">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .packet-print, .packet-print * { visibility: visible; }
          .packet-print { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; box-shadow: none !important; }
          .packet-overlay { position: static; background: none; padding: 0; }
        }
      `}</style>
      <div className="bg-white rounded-lg max-w-3xl w-full my-8 shadow-xl packet-print">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold">Authorization Packet</h2>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="btn-primary text-sm">🖨 Print</button>
            <button onClick={onClose} className="btn-secondary text-sm">Close</button>
          </div>
        </div>
        <div className="px-6 py-5">
          <PacketSection title="Patient">
            <dl>
              <Row label="Name" value={patientName(patient, auth)} />
              <Row label="DOB" value={patient.date_of_birth ? fmtDateOnly(patient.date_of_birth) : undefined} />
              <Row label="MRN" value={patient.mrn} />
              <Row label="Phone" value={patient.phone} />
            </dl>
          </PacketSection>
          <PacketSection title="Insurance">
            <dl>
              <Row label="Payer" value={insurance.payer_name || insurance.insurance_name || authorization.insurance_name} />
              <Row label="Member ID" value={insurance.member_id || insurance.policy_number} />
              <Row label="Group #" value={insurance.group_number} />
            </dl>
          </PacketSection>
          <PacketSection title="Authorization">
            <dl>
              <Row label="Auth Number" value={authorization.authorization_number || authorization.auth_number} />
              <Row label="Service Type" value={authorization.service_type} />
              <Row label="Status" value={authorization.workflow_status || authorization.status} />
              <Row label="Visits Authorized" value={authorization.authorized_visits ?? authorization.visits_authorized} />
              <Row label="Visits Used" value={authorization.used_visits ?? authorization.visits_used} />
              <Row label="Start Date" value={authorization.start_date ? fmtDateOnly(authorization.start_date) : undefined} />
              <Row label="End Date" value={authorization.end_date ? fmtDateOnly(authorization.end_date) : undefined} />
              <Row label="Follow-up Date" value={authorization.follow_up_date ? fmtDateOnly(authorization.follow_up_date) : undefined} />
            </dl>
          </PacketSection>
          <PacketSection title="Diagnosis Codes">
            {dxCodes.length > 0 ? (
              <ul className="list-disc ml-5 space-y-0.5">
                {dxCodes.map((c: any, i: number) => (
                  <li key={i} className="font-mono text-xs">
                    {typeof c === 'string' ? c : c.code}{typeof c === 'object' && c.description ? ` — ${c.description}` : ''}
                  </li>
                ))}
              </ul>
            ) : <span className="text-slate-400">None listed</span>}
          </PacketSection>
          <PacketSection title="Eval Summary">
            {p.evalNote ? (
              <div className="whitespace-pre-wrap text-sm">
                {[p.evalNote.subjective, p.evalNote.objective, p.evalNote.assessment, p.evalNote.plan]
                  .filter(Boolean).join('\n\n') || '—'}
              </div>
            ) : <span className="text-slate-400">Not attached</span>}
          </PacketSection>
          <PacketSection title="Plan of Care">
            <div className="whitespace-pre-wrap">{p.planOfCare || p.plan_of_care || '—'}</div>
          </PacketSection>
          <PacketSection title="Clinical Justification">
            <div className="whitespace-pre-wrap">{p.clinicalJustification || p.clinical_justification || '—'}</div>
          </PacketSection>
        </div>
      </div>
    </div>
  );
}

// ── Payer Requirements Library ──

function PayerRequirementsSection({ user }: { user: any }) {
  const [payers, setPayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_PAYER });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await api.get<any>('/payer-requirements');
      // Server returns { success, data: [...], meta } — extract the array robustly
      const rows = Array.isArray(res) ? res
        : Array.isArray(res?.data) ? res.data
        : Array.isArray(res?.items) ? res.items
        : [];
      setPayers(rows);
    } catch (err) {
      setError(err instanceof ApiError ? `Failed to load payer requirements: ${err.message}` : 'Failed to load payer requirements');
    } finally { setLoading(false); }
  }

  function openCreate() {
    setEditing(null); setForm({ ...EMPTY_PAYER }); setShowForm(true); setError('');
  }

  function openEdit(p: any) {
    setEditing(p);
    setForm({
      payer_name: p.payer_name || '',
      requires_auth_for_pt: p.requires_auth_for_pt ? 'yes' : 'no',
      typical_visit_limit: p.typical_visit_limit != null ? String(p.typical_visit_limit) : '',
      required_fields: (p.required_fields || []).join(', '),
      submission_notes: p.submission_notes || '',
      phone: p.phone || '',
      portal_url: p.portal_url || '',
    });
    setShowForm(true); setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const payload = {
      payer_name: form.payer_name,
      requires_auth_for_pt: form.requires_auth_for_pt === 'yes',
      typical_visit_limit: form.typical_visit_limit ? Number(form.typical_visit_limit) : null,
      required_fields: form.required_fields.split(',').map(s => s.trim()).filter(Boolean),
      submission_notes: form.submission_notes || null,
      phone: form.phone || null,
      portal_url: form.portal_url || null,
    };
    try {
      if (editing) await api.put(`/payer-requirements/${editing.id}`, payload);
      else await api.post('/payer-requirements', payload);
      setShowForm(false); load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Save failed'); }
  }

  async function handleDelete(id: string) {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    setConfirmDeleteId(null);
    try { await api.delete(`/payer-requirements/${id}`); load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Delete failed'); }
  }

  const setf = (field: string, val: string) => setForm(f => ({ ...f, [field]: val }));

  return (
    <div className="card space-y-3 mt-8">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Payer Requirements Library</h2>
        <button onClick={openCreate} className="btn-secondary text-sm">+ Add Payer</button>
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-slate-200 rounded p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="label">Payer Name *</label><input value={form.payer_name} onChange={e => setf('payer_name', e.target.value)} required className="input" /></div>
          <div>
            <label className="label">Requires Auth for PT</label>
            <select value={form.requires_auth_for_pt} onChange={e => setf('requires_auth_for_pt', e.target.value)} className="input">
              <option value="yes">Yes</option><option value="no">No</option>
            </select>
          </div>
          <div><label className="label">Typical Visit Limit</label><input type="number" min="0" value={form.typical_visit_limit} onChange={e => setf('typical_visit_limit', e.target.value)} className="input" /></div>
          <div><label className="label">Phone</label><input value={form.phone} onChange={e => setf('phone', e.target.value)} className="input" /></div>
          <div className="sm:col-span-2"><label className="label">Portal URL</label><input value={form.portal_url} onChange={e => setf('portal_url', e.target.value)} className="input" placeholder="https://..." /></div>
          <div className="sm:col-span-2"><label className="label">Required Fields (comma separated)</label><input value={form.required_fields} onChange={e => setf('required_fields', e.target.value)} className="input" placeholder="eval_note, plan_of_care, diagnosis_codes" /></div>
          <div className="sm:col-span-2"><label className="label">Submission Notes</label><textarea value={form.submission_notes} onChange={e => setf('submission_notes', e.target.value)} rows={2} className="input" /></div>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm">Cancel</button>
            <button type="submit" className="btn-primary text-sm">{editing ? 'Update' : 'Add'} Payer</button>
          </div>
        </form>
      )}

      {loading ? <Spinner /> : payers.length === 0 ? (
        <div className="text-center text-slate-500 py-6 text-sm">No payer requirements yet — add one to start the library.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-2">Payer</th>
                <th className="text-left px-4 py-2">Auth Required</th>
                <th className="text-left px-4 py-2">Typical Visits</th>
                <th className="text-left px-4 py-2">Phone</th>
                <th className="text-left px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payers.map((p: any) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">{p.payer_name}</td>
                  <td className="px-4 py-2">
                    <span className={p.requires_auth_for_pt ? 'badge-yellow' : 'badge-green'}>
                      {p.requires_auth_for_pt ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-2">{p.typical_visit_limit ?? '-'}</td>
                  <td className="px-4 py-2 text-xs">{p.phone || '-'}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(p)} className="text-xs text-primary-600 underline">Edit</button>
                      <button onClick={() => handleDelete(p.id)} className="text-xs text-red-600 underline">
                        {confirmDeleteId === p.id ? 'Confirm delete?' : 'Delete'}
                      </button>
                    </div>
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
