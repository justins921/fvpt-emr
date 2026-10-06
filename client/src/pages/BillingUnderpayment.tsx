
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';

export function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return '-';
  return `$${(cents / 100).toFixed(2)}`;
}

function unwrap(res: any): any {
  // api service returns the parsed body; endpoints wrap in { success, data }
  if (res && typeof res === 'object' && 'success' in res) return res.data;
  return res;
}

export function UnderpaymentsQueue() {
  const [flags, setFlags] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [threshold, setThreshold] = useState<number>(100);
  const [thresholdInput, setThresholdInput] = useState('1.00');
  const [statusFilter, setStatusFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('in_review');
  const [editNotes, setEditNotes] = useState('');

  useEffect(() => { load(); }, [statusFilter]);

  async function load() {
    setLoading(true);
    try {
      const [flagsRes, summaryRes, threshRes] = await Promise.all([
        api.get<any>(`/billing/underpayments${statusFilter ? `?status=${statusFilter}` : ''}`),
        api.get<any>('/billing/underpayments/summary'),
        api.get<any>('/billing/settings/underpayment-threshold'),
      ]);
      setFlags(unwrap(flagsRes) || []);
      setSummary(unwrap(summaryRes));
      const t = unwrap(threshRes)?.threshold_cents ?? 100;
      setThreshold(t);
      setThresholdInput((t / 100).toFixed(2));
    } catch {
      setMessage({ type: 'error', text: 'Failed to load underpayments' });
    } finally {
      setLoading(false);
    }
  }

  async function runDetection() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await api.post<any>('/billing/underpayments/run', {});
      const d = unwrap(res);
      setMessage({
        type: 'success',
        text: `Detection complete: ${d.flagged} new flag(s), ${d.updated} updated, ${d.missingRates} line(s) skipped (no contracted rate) across ${d.erasScanned} ERA(s).`,
      });
      load();
    } catch {
      setMessage({ type: 'error', text: 'Detection run failed' });
    } finally {
      setRunning(false);
    }
  }

  async function saveThreshold() {
    const dollars = parseFloat(thresholdInput);
    if (isNaN(dollars) || dollars < 0) {
      setMessage({ type: 'error', text: 'Enter a valid threshold amount (0 or more)' });
      return;
    }
    try {
      await api.put<any>('/billing/settings/underpayment-threshold', { threshold_cents: Math.round(dollars * 100) });
      setMessage({ type: 'success', text: 'Threshold updated' });
      load();
    } catch {
      setMessage({ type: 'error', text: 'Failed to update threshold' });
    }
  }

  function startEdit(flag: any) {
    setEditingId(flag.id);
    setEditStatus(flag.status === 'open' ? 'in_review' : flag.status);
    setEditNotes(flag.notes || '');
  }

  async function saveEdit(id: string) {
    try {
      await api.put<any>(`/billing/underpayments/${id}`, { status: editStatus, notes: editNotes || null });
      setEditingId(null);
      setMessage({ type: 'success', text: 'Flag updated' });
      load();
    } catch {
      setMessage({ type: 'error', text: 'Failed to update flag' });
    }
  }

  const statusColors: Record<string, string> = {
    open: 'badge-red', in_review: 'badge-yellow', appealed: 'badge-blue',
    resolved: 'badge-green', wont_pursue: 'badge-gray',
  };
  const statusLabels: Record<string, string> = {
    open: 'Open', in_review: 'In Review', appealed: 'Appealed',
    resolved: 'Resolved', "won't pursue": "Won't Pursue",
  };
  const statusLabel = (s: string) => statusLabels[s] || s.replace('_', ' ');

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

  return (
    <div className="space-y-4">
      {message && (
        <div className={`px-4 py-3 rounded border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-3 underline text-xs">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <div className="text-sm text-slate-500">Open shortfall</div>
          <div className="text-3xl font-bold text-red-600 mt-1">{fmtCents(summary?.openShortfallCents)}</div>
          <div className="text-xs text-slate-500">{summary?.openCount ?? 0} open flag(s)</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">Detection threshold</div>
          <div className="flex gap-2 mt-2 items-center">
            <span className="text-sm text-slate-500">$</span>
            <input value={thresholdInput} onChange={e => setThresholdInput(e.target.value)} className="input w-24" inputMode="decimal" />
            <button onClick={saveThreshold} className="btn-secondary text-sm">Save</button>
          </div>
          <div className="text-xs text-slate-500 mt-1">Flag when paid is short by at least this much</div>
        </div>
        <div className="card flex flex-col justify-center">
          <button onClick={runDetection} disabled={running} className="btn-primary text-sm disabled:opacity-50">
            {running ? 'Running…' : 'Run detection on posted ERAs'}
          </button>
          <div className="text-xs text-slate-500 mt-2">Auto-runs on every ERA post. Use this for historical claims.</div>
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input max-w-xs">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_review">In Review</option>
          <option value="appealed">Appealed</option>
          <option value="resolved">Resolved</option>
          <option value="wont_pursue">Won't Pursue</option>
        </select>
      </div>

      {flags.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">
          No underpayment flags{statusFilter ? ` with status "${statusLabel(statusFilter)}"` : ''}. Add fee schedule rates, then run detection.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Claim</th>
                <th className="text-left px-4 py-3">Patient</th>
                <th className="text-left px-4 py-3">Payer</th>
                <th className="text-left px-4 py-3">CPT</th>
                <th className="text-right px-4 py-3">Billed</th>
                <th className="text-right px-4 py-3">Allowed</th>
                <th className="text-right px-4 py-3">Paid</th>
                <th className="text-right px-4 py-3">Shortfall</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {flags.map((f: any) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{f.claim_number || '-'}</td>
                  <td className="px-4 py-3">
                    <Link to={`/app/patients/${f.patient_id}`} className="text-primary-600 hover:underline">
                      {f.patient_last_name}, {f.patient_first_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs">{f.payer_name || '-'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{f.cpt_code}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtCents(f.billed_cents)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtCents(f.allowed_cents)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtCents(f.paid_cents)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-red-600">{fmtCents(f.shortfall_cents)}</td>
                  <td className="px-4 py-3"><span className={statusColors[f.status] || 'badge-gray'}>{statusLabel(f.status)}</span></td>
                  <td className="px-4 py-3">
                    {editingId === f.id ? (
                      <div className="space-y-2 min-w-[220px]">
                        <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className="input text-xs">
                          <option value="open">Open</option>
                          <option value="in_review">In Review</option>
                          <option value="appealed">Appealed</option>
                          <option value="resolved">Resolved</option>
                          <option value="wont_pursue">Won't Pursue</option>
                        </select>
                        <input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notes (optional)" className="input text-xs" />
                        <div className="flex gap-2">
                          <button onClick={() => saveEdit(f.id)} className="text-xs text-green-700 underline">Save</button>
                          <button onClick={() => setEditingId(null)} className="text-xs text-slate-500 underline">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(f)} className="text-xs text-blue-600 underline">Review</button>
                    )}
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

export function FeeSchedules() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState('');
  const [formPayer, setFormPayer] = useState('');
  const [formDate, setFormDate] = useState('');
  const [itemCpt, setItemCpt] = useState('');
  const [itemAmount, setItemAmount] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<any>('/billing/fee-schedules');
      const list = unwrap(res) || [];
      setSchedules(list);
      if (selectedId) {
        const d = await api.get<any>(`/billing/fee-schedules/${selectedId}`);
        setDetail(unwrap(d));
      } else if (list.length > 0 && !detail) {
        // auto-select first schedule on initial load
        const d = await api.get<any>(`/billing/fee-schedules/${list[0].id}`);
        setDetail(unwrap(d));
        setSelectedId(list[0].id);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to load fee schedules' });
    } finally {
      setLoading(false);
    }
  }

  async function selectSchedule(id: string) {
    setSelectedId(id);
    try {
      const d = await api.get<any>(`/billing/fee-schedules/${id}`);
      setDetail(unwrap(d));
    } catch {
      setMessage({ type: 'error', text: 'Failed to load schedule detail' });
    }
  }

  async function createSchedule() {
    if (!formName.trim()) {
      setMessage({ type: 'error', text: 'Schedule name is required' });
      return;
    }
    try {
      const res = await api.post<any>('/billing/fee-schedules', {
        name: formName.trim(),
        payer_name: formPayer.trim() || null,
        effective_date: formDate || null,
      });
      const created = unwrap(res);
      setFormName(''); setFormPayer(''); setFormDate(''); setShowCreate(false);
      setMessage({ type: 'success', text: `Schedule "${created.name}" created` });
      await load();
      if (created?.id) selectSchedule(created.id);
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Failed to create schedule' });
    }
  }

  async function addItem() {
    const cpt = itemCpt.trim().toUpperCase();
    const dollars = parseFloat(itemAmount);
    if (!cpt) { setMessage({ type: 'error', text: 'CPT code is required' }); return; }
    if (isNaN(dollars) || dollars < 0) { setMessage({ type: 'error', text: 'Enter a valid allowed amount (0 or more)' }); return; }
    if (!selectedId) return;
    try {
      await api.post<any>(`/billing/fee-schedules/${selectedId}/items`, {
        cpt_code: cpt, allowed_amount_cents: Math.round(dollars * 100),
      });
      setItemCpt(''); setItemAmount('');
      setMessage({ type: 'success', text: `Rate for ${cpt} saved` });
      selectSchedule(selectedId);
      load();
    } catch {
      setMessage({ type: 'error', text: 'Failed to save rate' });
    }
  }

  async function deleteItem(itemId: string) {
    if (!selectedId) return;
    try {
      await api.delete<any>(`/billing/fee-schedules/${selectedId}/items/${itemId}`);
      selectSchedule(selectedId);
      load();
    } catch {
      setMessage({ type: 'error', text: 'Failed to delete rate' });
    }
  }

  async function deleteSchedule(id: string) {
    try {
      await api.delete<any>(`/billing/fee-schedules/${id}`);
      setConfirmDelete(null);
      if (selectedId === id) { setSelectedId(null); setDetail(null); }
      setMessage({ type: 'success', text: 'Schedule deleted' });
      load();
    } catch {
      setMessage({ type: 'error', text: 'Failed to delete schedule' });
    }
  }

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

  return (
    <div className="space-y-4">
      {message && (
        <div className={`px-4 py-3 rounded border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-3 underline text-xs">Dismiss</button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">Contracted rates per payer. Detection compares ERA payments against these. A schedule with no payer acts as the default.</p>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary text-sm">New Schedule</button>
      </div>

      {showCreate && (
        <div className="card space-y-3">
          <h3 className="font-semibold">New fee schedule</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="label">Name *</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. 2026 Standard Rates" className="input" />
            </div>
            <div>
              <label className="label">Payer (blank = default)</label>
              <input value={formPayer} onChange={e => setFormPayer(e.target.value)} placeholder="e.g. Medicare" className="input" />
            </div>
            <div>
              <label className="label">Effective date</label>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} className="input" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createSchedule} className="btn-primary text-sm">Create</button>
            <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b font-semibold text-sm">Schedules</div>
          {schedules.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-500 text-center">No fee schedules yet</div>
          ) : (
            <ul className="divide-y">
              {schedules.map((s: any) => (
                <li key={s.id}>
                  <button onClick={() => selectSchedule(s.id)} className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${selectedId === s.id ? 'bg-blue-50' : ''}`}>
                    <div className="font-medium text-sm">{s.name}</div>
                    <div className="text-xs text-slate-500">
                      {s.payer_name ? s.payer_name : <span className="text-blue-700 font-medium">Default</span>}
                      {' · '}{s.item_count} rate(s)
                      {s.effective_date ? ` · eff. ${s.effective_date}` : ''}
                      {!s.is_active ? ' · inactive' : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card md:col-span-2">
          {!detail ? (
            <div className="text-sm text-slate-500 text-center py-8">Select a schedule to manage its rates</div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold">{detail.name}</h3>
                  <div className="text-xs text-slate-500">{detail.payer_name || 'Default schedule'}{detail.effective_date ? ` · effective ${detail.effective_date}` : ''}</div>
                </div>
                {confirmDelete === detail.id ? (
                  <div className="flex gap-2 items-center text-sm">
                    <span className="text-red-700">Delete this schedule and all its rates?</span>
                    <button onClick={() => deleteSchedule(detail.id)} className="text-xs text-red-700 underline font-medium">Confirm</button>
                    <button onClick={() => setConfirmDelete(null)} className="text-xs text-slate-500 underline">Back</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDelete(detail.id)} className="text-xs text-red-600 underline">Delete schedule</button>
                )}
              </div>

              <div className="flex gap-2 items-end">
                <div>
                  <label className="label">CPT</label>
                  <input value={itemCpt} onChange={e => setItemCpt(e.target.value)} placeholder="97110" className="input w-28" />
                </div>
                <div>
                  <label className="label">Allowed amount ($)</label>
                  <input value={itemAmount} onChange={e => setItemAmount(e.target.value)} placeholder="32.00" className="input w-32" inputMode="decimal" />
                </div>
                <button onClick={addItem} className="btn-secondary text-sm">Add / Update Rate</button>
              </div>

              {(detail.items || []).length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-6">No rates yet — add CPT codes above</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-2">CPT</th>
                        <th className="text-right px-4 py-2">Allowed</th>
                        <th className="text-left px-4 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {detail.items.map((it: any) => (
                        <tr key={it.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2 font-mono text-xs">{it.cpt_code}</td>
                          <td className="px-4 py-2 text-right font-mono">{fmtCents(it.allowed_amount_cents)}</td>
                          <td className="px-4 py-2">
                            <button onClick={() => deleteItem(it.id)} className="text-xs text-red-600 underline">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
