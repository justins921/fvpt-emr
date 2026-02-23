import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface MeasureDefinition {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  min_score: number;
  max_score: number;
  mcid: number;
  higher_is_better: boolean;
  body_region: string;
}

interface PatientMeasure {
  id: string;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  definition_id: string;
  measure_name: string;
  abbreviation: string;
  score: number;
  percentage: number;
  administered_at: string;
  administered_by_name: string;
  notes: string;
}

interface TrendPoint {
  date: string;
  score: number;
  percentage: number;
}

interface PatientOption {
  id: string;
  first_name: string;
  last_name: string;
  mrn: string;
}

export default function OutcomeMeasuresPage() {
  const { user } = useAuth();
  const [definitions, setDefinitions] = useState<MeasureDefinition[]>([]);
  const [measures, setMeasures] = useState<PatientMeasure[]>([]);
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<PatientOption[]>([]);

  // Filters
  const [filterPatient, setFilterPatient] = useState('');
  const [filterMeasure, setFilterMeasure] = useState('');

  // New score form
  const [showForm, setShowForm] = useState(false);
  const [formPatientId, setFormPatientId] = useState('');
  const [formDefinitionId, setFormDefinitionId] = useState('');
  const [formScore, setFormScore] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Trend view
  const [trendPatientId, setTrendPatientId] = useState('');
  const [trendDefinitionId, setTrendDefinitionId] = useState('');
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [loadingTrend, setLoadingTrend] = useState(false);

  useEffect(() => { loadInitial(); }, []);
  useEffect(() => { loadMeasures(); }, [filterPatient, filterMeasure]);

  async function loadInitial() {
    try {
      const [defRes, ptRes] = await Promise.all([
        api.get<any>('/outcome-measures/definitions'),
        api.get<any>('/patients?limit=200'),
      ]);
      setDefinitions(defRes.data || []);
      setPatients(ptRes.data || []);
    } catch {} finally { setLoading(false); }
    loadMeasures();
  }

  async function loadMeasures() {
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (filterPatient) params.set('patientId', filterPatient);
      if (filterMeasure) params.set('definitionId', filterMeasure);
      const res = await api.get<any>(`/outcome-measures?${params}`);
      setMeasures(res.data || []);
    } catch {}
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!formPatientId || !formDefinitionId || formScore === '') return;
    setSaving(true);
    try {
      await api.post('/outcome-measures', {
        patientId: formPatientId,
        definitionId: formDefinitionId,
        score: Number(formScore),
        notes: formNotes || null,
      });
      setShowForm(false);
      resetForm();
      loadMeasures();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to save measure');
    } finally { setSaving(false); }
  }

  function resetForm() {
    setFormPatientId('');
    setFormDefinitionId('');
    setFormScore('');
    setFormNotes('');
  }

  async function loadTrend(patientId: string, definitionId: string) {
    setTrendPatientId(patientId);
    setTrendDefinitionId(definitionId);
    setLoadingTrend(true);
    try {
      const res = await api.get<any>(`/outcome-measures/trend?patientId=${patientId}&definitionId=${definitionId}`);
      setTrendData(res.data || []);
    } catch {} finally { setLoadingTrend(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this outcome measure?')) return;
    try {
      await api.delete(`/outcome-measures/${id}`);
      loadMeasures();
    } catch {}
  }

  const selectedDef = definitions.find(d => d.id === formDefinitionId);
  const trendDef = definitions.find(d => d.id === trendDefinitionId);
  const trendPatient = patients.find(p => p.id === trendPatientId);

  if (loading) {
    return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Outcome Measures</h1>
          <p className="text-sm text-slate-500 mt-1">Track patient functional outcomes over time</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">+ Record Score</button>
      </div>

      {/* Available measures */}
      <div className="card">
        <h2 className="font-semibold text-sm mb-2">Available Measures</h2>
        <div className="flex flex-wrap gap-2">
          {definitions.map(def => (
            <div key={def.id} className="border rounded-lg px-3 py-2 text-xs bg-slate-50">
              <span className="font-medium">{def.abbreviation}</span>
              <span className="text-slate-500 ml-1">{def.name}</span>
              <span className="text-slate-400 ml-1">({def.min_score}-{def.max_score})</span>
            </div>
          ))}
          {definitions.length === 0 && <span className="text-sm text-slate-400">No definitions configured</span>}
        </div>
      </div>

      {/* Score entry form */}
      {showForm && (
        <form onSubmit={handleSave} className="card space-y-3">
          <h3 className="font-semibold text-sm">Record Outcome Score</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="label">Patient *</label>
              <select value={formPatientId} onChange={e => setFormPatientId(e.target.value)} required className="input">
                <option value="">Select patient...</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.last_name}, {p.first_name} ({p.mrn})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Measure *</label>
              <select value={formDefinitionId} onChange={e => setFormDefinitionId(e.target.value)} required className="input">
                <option value="">Select measure...</option>
                {definitions.map(d => <option key={d.id} value={d.id}>{d.abbreviation} - {d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">
                Score *
                {selectedDef && <span className="text-slate-400 font-normal ml-1">({selectedDef.min_score}-{selectedDef.max_score})</span>}
              </label>
              <input
                type="number" value={formScore}
                onChange={e => setFormScore(e.target.value)}
                min={selectedDef?.min_score} max={selectedDef?.max_score}
                required className="input"
              />
            </div>
            <div>
              <label className="label">Notes</label>
              <input value={formNotes} onChange={e => setFormNotes(e.target.value)} className="input" placeholder="Optional notes..." />
            </div>
          </div>
          {selectedDef && formScore !== '' && (
            <div className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
              Score: <span className="font-medium">{formScore}</span> / {selectedDef.max_score}
              {' = '}
              <span className="font-medium">{((Number(formScore) - selectedDef.min_score) / (selectedDef.max_score - selectedDef.min_score) * 100).toFixed(0)}%</span>
              {selectedDef.mcid > 0 && <span className="ml-2 text-slate-400">(MCID: {selectedDef.mcid})</span>}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Score'}</button>
          </div>
        </form>
      )}

      {/* Trend viewer */}
      {trendPatientId && trendDefinitionId && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">
              Trend: {trendPatient ? `${trendPatient.last_name}, ${trendPatient.first_name}` : ''} - {trendDef?.abbreviation}
            </h3>
            <button onClick={() => { setTrendPatientId(''); setTrendDefinitionId(''); setTrendData([]); }} className="text-xs text-slate-400 underline">Close</button>
          </div>
          {loadingTrend ? (
            <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
          ) : trendData.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-4">No trend data available</div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-3 text-xs font-medium text-slate-500 px-2 pb-1 border-b">
                <span>Date</span><span className="text-center">Score</span><span className="text-right">%</span>
              </div>
              {trendData.map((pt, i) => {
                const prev = i > 0 ? trendData[i - 1] : null;
                const change = prev ? pt.score - prev.score : 0;
                const improved = trendDef?.higher_is_better ? change > 0 : change < 0;
                const mcidMet = trendDef?.mcid ? Math.abs(change) >= trendDef.mcid : false;
                return (
                  <div key={pt.date} className="grid grid-cols-3 text-sm px-2 py-1 hover:bg-slate-50 rounded">
                    <span className="text-slate-600">{new Date(pt.date).toLocaleDateString()}</span>
                    <span className="text-center font-mono">
                      {pt.score}
                      {prev && (
                        <span className={`ml-1 text-xs ${improved ? 'text-green-600' : change === 0 ? 'text-slate-400' : 'text-red-500'}`}>
                          ({change > 0 ? '+' : ''}{change}{mcidMet ? '*' : ''})
                        </span>
                      )}
                    </span>
                    <span className="text-right font-mono text-slate-500">{pt.percentage.toFixed(0)}%</span>
                  </div>
                );
              })}
              {trendDef?.mcid && <div className="text-xs text-slate-400 mt-2 px-2">* Change meets or exceeds MCID ({trendDef.mcid})</div>}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <select value={filterPatient} onChange={e => setFilterPatient(e.target.value)} className="input max-w-xs">
          <option value="">All Patients</option>
          {patients.map(p => <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}</option>)}
        </select>
        <select value={filterMeasure} onChange={e => setFilterMeasure(e.target.value)} className="input max-w-xs">
          <option value="">All Measures</option>
          {definitions.map(d => <option key={d.id} value={d.id}>{d.abbreviation}</option>)}
        </select>
      </div>

      {/* Measures list */}
      {measures.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No outcome measures recorded yet.</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Patient</th>
                <th className="text-left px-4 py-3">Measure</th>
                <th className="text-center px-4 py-3">Score</th>
                <th className="text-center px-4 py-3">%</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">By</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {measures.map(m => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{m.patient_last_name}, {m.patient_first_name}</td>
                  <td className="px-4 py-3">
                    <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded-full">{m.abbreviation}</span>
                  </td>
                  <td className="px-4 py-3 text-center font-mono">{m.score}</td>
                  <td className="px-4 py-3 text-center font-mono">{m.percentage.toFixed(0)}%</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(m.administered_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{m.administered_by_name}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => loadTrend(m.patient_id, m.definition_id)}
                        className="text-xs text-primary-600 underline"
                      >
                        Trend
                      </button>
                      <button onClick={() => handleDelete(m.id)} className="text-xs text-red-500 underline">Delete</button>
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
