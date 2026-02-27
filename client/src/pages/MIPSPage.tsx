import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const Spinner = () => (
  <div className="flex justify-center py-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
  </div>
);

export default function MIPSPage() {
  const { user } = useAuth();
  const [definitions, setDefinitions] = useState<any[]>([]);
  const [summary, setSummary] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [providerId, setProviderId] = useState('');
  const [providers, setProviders] = useState<any[]>([]);
  const [showRecord, setShowRecord] = useState(false);
  const [recordForm, setRecordForm] = useState({
    measure_id: '',
    patient_id: '',
    numerator: true,
    denominator: true,
    exclusion: false,
  });
  const [patients, setPatients] = useState<any[]>([]);

  useEffect(() => { loadProviders(); loadPatients(); }, []);
  useEffect(() => { loadDefinitions(); loadSummary(); }, [year, providerId]);

  async function loadProviders() {
    try {
      const res = await api.get<any>('/users');
      setProviders((res.data || []).filter((u: any) =>
        ['therapist', 'owner', 'admin'].includes(u.role) && u.is_active
      ));
    } catch {}
  }

  async function loadPatients() {
    try {
      const res = await api.get<any>('/patients?limit=500');
      setPatients(res.data || []);
    } catch {}
  }

  async function loadDefinitions() {
    setLoading(true);
    try {
      const res = await api.get<any>('/mips/definitions');
      setDefinitions(res.data || []);
    } catch { setError('Failed to load measure definitions'); } finally { setLoading(false); }
  }

  async function loadSummary() {
    try {
      const res = await api.get<any>(`/mips/summary?year=${year}${providerId ? `&provider_id=${providerId}` : ''}`);
      // Backend returns { year, provider_id, measures: [...] }
      const data = res.data;
      setSummary(data?.measures || []);
    } catch {}
  }

  async function handleRecord(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    const measure = definitions.find((d: any) => d.measure_id === recordForm.measure_id);
    if (!measure) { setError('Select a measure'); return; }
    try {
      await api.post('/mips', {
        measure_id: recordForm.measure_id,
        measure_title: measure.title,
        patient_id: recordForm.patient_id,
        provider_id: providerId || user?.id,
        numerator: recordForm.numerator,
        denominator: recordForm.denominator,
        exclusion: recordForm.exclusion,
        reporting_period_start: `${year}-01-01`,
        reporting_period_end: `${year}-12-31`,
      });
      setSuccess('Measure recorded');
      setShowRecord(false);
      setRecordForm({ measure_id: '', patient_id: '', numerator: true, denominator: true, exclusion: false });
      loadSummary();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record measure');
    }
  }

  async function handleSubmit() {
    if (!confirm(`Submit MIPS data for ${year}? This cannot be undone.`)) return;
    setError(''); setSuccess('');
    try {
      await api.post('/mips/submit', { year, provider_id: providerId || user?.id });
      setSuccess(`MIPS data submitted for ${year}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submission failed');
    }
  }

  function getRateForMeasure(measureId: string) {
    const s = summary.find((m: any) => m.measure_id === measureId);
    if (!s) return null;
    const denominator = parseInt(s.denominator_count, 10) || 0;
    const numerator = parseInt(s.numerator_count, 10) || 0;
    const exclusions = parseInt(s.exclusion_count, 10) || 0;
    const eligible = denominator - exclusions;
    if (eligible <= 0) return null;
    const rate = ((numerator / eligible) * 100).toFixed(1);
    return { met: numerator, total: eligible, rate };
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-bold">MIPS Quality Reporting</h1>
        <div className="flex gap-2">
          <button onClick={() => { setShowRecord(true); setError(''); setSuccess(''); }} className="btn-primary text-sm">+ Record Measure</button>
          <button onClick={handleSubmit} className="btn-secondary text-sm">Submit {year}</button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">{success}</div>}

      <div className="flex gap-3 items-center">
        <div>
          <label className="label">Reporting Year</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="input w-32">
            {[0, 1, 2].map(offset => {
              const y = new Date().getFullYear() - offset;
              return <option key={y} value={y}>{y}</option>;
            })}
          </select>
        </div>
        <div>
          <label className="label">Provider</label>
          <select value={providerId} onChange={e => setProviderId(e.target.value)} className="input w-64">
            <option value="">All Providers</option>
            {providers.map((p: any) => (
              <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}</option>
            ))}
          </select>
        </div>
      </div>

      {showRecord && (
        <form onSubmit={handleRecord} className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
          <h3 className="sm:col-span-2 font-semibold">Record Measure</h3>
          <div>
            <label className="label">Measure *</label>
            <select value={recordForm.measure_id} onChange={e => setRecordForm(f => ({ ...f, measure_id: e.target.value }))} required className="input">
              <option value="">Select measure...</option>
              {definitions.map((d: any) => (
                <option key={d.measure_id} value={d.measure_id}>{d.measure_id} - {d.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Patient *</label>
            <select value={recordForm.patient_id} onChange={e => setRecordForm(f => ({ ...f, patient_id: e.target.value }))} required className="input">
              <option value="">Select patient...</option>
              {patients.map((p: any) => (
                <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 flex gap-4 items-center">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={recordForm.denominator} onChange={e => setRecordForm(f => ({ ...f, denominator: e.target.checked }))} className="rounded" />
              In Denominator
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={recordForm.numerator} onChange={e => setRecordForm(f => ({ ...f, numerator: e.target.checked }))} className="rounded" />
              Numerator Met
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={recordForm.exclusion} onChange={e => setRecordForm(f => ({ ...f, exclusion: e.target.checked }))} className="rounded" />
              Exclusion
            </label>
          </div>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowRecord(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Record</button>
          </div>
        </form>
      )}

      {loading ? <Spinner /> : definitions.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No MIPS measure definitions found</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Measure #</th>
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-center px-4 py-3">Priority</th>
                <th className="text-right px-4 py-3">Met</th>
                <th className="text-right px-4 py-3">Eligible</th>
                <th className="text-left px-4 py-3">Performance Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {definitions.map((d: any) => {
                const rate = getRateForMeasure(d.measure_id);
                return (
                  <tr key={d.measure_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono">{d.measure_id}</td>
                    <td className="px-4 py-3">{d.title}</td>
                    <td className="px-4 py-3 text-slate-500">{d.category || '-'}</td>
                    <td className="px-4 py-3 text-center">{d.high_priority ? <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">High</span> : '-'}</td>
                    <td className="px-4 py-3 text-right font-mono">{rate?.met ?? '-'}</td>
                    <td className="px-4 py-3 text-right font-mono">{rate?.total ?? '-'}</td>
                    <td className="px-4 py-3 w-48">
                      {rate ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-200 rounded-full h-2">
                            <div className={`h-2 rounded-full ${Number(rate.rate) >= 70 ? 'bg-green-500' : Number(rate.rate) >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                              style={{ width: `${Math.min(Number(rate.rate), 100)}%` }} />
                          </div>
                          <span className="text-xs font-mono w-12 text-right">{rate.rate}%</span>
                        </div>
                      ) : <span className="text-slate-400">No data</span>}
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
