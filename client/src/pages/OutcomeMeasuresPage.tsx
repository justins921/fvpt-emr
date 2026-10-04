import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';

interface ScoringBracket {
  min: number;
  max: number;
  label: string;
}

interface MeasureDefinition {
  name: string;
  key: string;
  maxScore: number;
  description: string;
  scoring: ScoringBracket[];
  categories: string[];
  itemMin: number;
  itemMax: number;
  mcid: number;
  higherIsBetter: boolean;
}

interface OutcomeRecord {
  id: string;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  patient_mrn: string;
  measure_type: string;
  score: number;
  max_score: number;
  percentage: number;
  interpretation: string | null;
  administered_date: string;
  administered_by_first_name: string;
  administered_by_last_name: string;
}

interface PatientOption {
  id: string;
  first_name: string;
  last_name: string;
  mrn: string;
}

interface CalcResult {
  score: number;
  maxScore: number;
  percentage: number;
  interpretation: string | null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function OutcomeMeasuresPage() {
  const [definitions, setDefinitions] = useState<MeasureDefinition[]>([]);
  const [records, setRecords] = useState<OutcomeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<PatientOption[]>([]);

  // Filters
  const [filterPatient, setFilterPatient] = useState('');
  const [filterMeasure, setFilterMeasure] = useState('');

  // Record form
  const [showForm, setShowForm] = useState(false);
  const [formPatientId, setFormPatientId] = useState('');
  const [formMeasureKey, setFormMeasureKey] = useState('');
  const [formDate, setFormDate] = useState(todayISO());
  const [responses, setResponses] = useState<Record<number, string>>({});
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Trend view
  const [trendPatientId, setTrendPatientId] = useState('');
  const [trendMeasureKey, setTrendMeasureKey] = useState('');
  const [trendData, setTrendData] = useState<{ date: string; score: number; percentage: number }[]>([]);
  const [loadingTrend, setLoadingTrend] = useState(false);

  useEffect(() => { loadInitial(); }, []);
  useEffect(() => { loadRecords(); }, [filterPatient, filterMeasure]);

  async function loadInitial() {
    try {
      const [defRes, ptRes] = await Promise.all([
        api.get<any>('/outcome-measures/definitions'),
        api.get<any>('/patients?limit=200'),
      ]);
      setDefinitions(defRes.data || []);
      setPatients(ptRes.data || []);
    } catch {} finally { setLoading(false); }
    loadRecords();
  }

  async function loadRecords() {
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (filterPatient) params.set('patient_id', filterPatient);
      if (filterMeasure) params.set('measure_type', filterMeasure);
      const res = await api.get<any>(`/outcome-measures?${params}`);
      setRecords(res.data || []);
    } catch {}
  }

  const selectedDef = definitions.find(d => d.key === formMeasureKey);

  function setResponse(idx: number, value: string) {
    setResponses(prev => ({ ...prev, [idx]: value }));
    setCalcResult(null);
  }

  function numericResponses(): Record<string, number> | null {
    if (!selectedDef) return null;
    // PSFS allows fewer than 5 activities; all other measures require every item.
    const allowPartial = selectedDef.key === 'PSFS';
    const out: Record<string, number> = {};
    for (let i = 0; i < selectedDef.categories.length; i++) {
      const raw = responses[i];
      if (raw === undefined || raw === '') {
        if (allowPartial) continue;
        return null;
      }
      const n = Number(raw);
      if (Number.isNaN(n) || n < selectedDef.itemMin || n > selectedDef.itemMax) return null;
      out[String(i)] = n;
    }
    if (Object.keys(out).length === 0) return null;
    return out;
  }

  const responsesComplete = numericResponses() !== null;

  async function handleCalculate() {
    const resp = numericResponses();
    if (!resp || !selectedDef) return;
    setCalculating(true);
    try {
      const res = await api.post<any>('/outcome-measures/calculate', {
        measureType: selectedDef.key,
        responses: resp,
      });
      setCalcResult(res.data);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Calculation failed');
    } finally { setCalculating(false); }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const resp = numericResponses();
    if (!formPatientId || !selectedDef || !resp || !calcResult) return;
    setSaving(true);
    try {
      await api.post('/outcome-measures', {
        patientId: formPatientId,
        measureType: selectedDef.key,
        score: calcResult.score,
        maxScore: calcResult.maxScore,
        percentage: calcResult.percentage,
        responses: resp,
        administeredDate: formDate,
        interpretation: calcResult.interpretation,
      });
      setShowForm(false);
      resetForm();
      loadRecords();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to save measure');
    } finally { setSaving(false); }
  }

  function resetForm() {
    setFormPatientId('');
    setFormMeasureKey('');
    setFormDate(todayISO());
    setResponses({});
    setCalcResult(null);
  }

  async function loadTrend(patientId: string, measureKey: string) {
    setTrendPatientId(patientId);
    setTrendMeasureKey(measureKey);
    setLoadingTrend(true);
    try {
      const res = await api.get<any>(`/outcome-measures/patient/${patientId}/trends`);
      const grouped = res.data || {};
      setTrendData(grouped[measureKey] || []);
    } catch {} finally { setLoadingTrend(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this outcome measure?')) return;
    try {
      await api.delete(`/outcome-measures/${id}`);
      loadRecords();
    } catch {
      alert('Delete failed');
    }
  }

  const trendDef = definitions.find(d => d.key === trendMeasureKey);
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
            <div key={def.key} className="border rounded-lg px-3 py-2 text-xs bg-slate-50" title={def.description}>
              <span className="font-medium">{def.key}</span>
              <span className="text-slate-500 ml-1">{def.name}</span>
              <span className="text-slate-400 ml-1">(0-{def.maxScore})</span>
            </div>
          ))}
          {definitions.length === 0 && <span className="text-sm text-slate-400">No definitions configured</span>}
        </div>
      </div>

      {/* Score entry form with questionnaire */}
      {showForm && (
        <form onSubmit={handleSave} className="card space-y-4">
          <h3 className="font-semibold text-sm">Record Outcome Score</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Patient *</label>
              <select value={formPatientId} onChange={e => setFormPatientId(e.target.value)} required className="input">
                <option value="">Select patient...</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.last_name}, {p.first_name} ({p.mrn})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Measure *</label>
              <select value={formMeasureKey} onChange={e => { setFormMeasureKey(e.target.value); setResponses({}); setCalcResult(null); }} required className="input">
                <option value="">Select measure...</option>
                {definitions.map(d => <option key={d.key} value={d.key}>{d.key} - {d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date *</label>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} required className="input" />
            </div>
          </div>

          {selectedDef && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">{selectedDef.description} Rate each item {selectedDef.itemMin}-{selectedDef.itemMax}{selectedDef.key === 'PSFS' ? ' (at least one activity)' : ''}.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                {selectedDef.categories.map((cat, i) => (
                  <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-lg px-3 py-2">
                    <span className="flex-1 text-sm">{i + 1}. {cat}</span>
                    <input
                      type="number"
                      min={selectedDef.itemMin}
                      max={selectedDef.itemMax}
                      value={responses[i] ?? ''}
                      onChange={e => setResponse(i, e.target.value)}
                      className="input w-20 text-center"
                      placeholder={`${selectedDef.itemMin}-${selectedDef.itemMax}`}
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCalculate}
                  disabled={!responsesComplete || calculating}
                  className="btn-secondary text-sm disabled:opacity-50"
                >
                  {calculating ? 'Calculating...' : 'Calculate Score'}
                </button>
                {!responsesComplete && (
                  <span className="text-xs text-slate-400">{selectedDef.key === 'PSFS' ? 'Answer at least one activity to calculate.' : 'Answer every item to calculate.'}</span>
                )}
              </div>

              {calcResult && (
                <div className="text-sm bg-green-50 border border-green-200 rounded-lg px-4 py-3 space-y-1">
                  <div>
                    Score: <span className="font-bold text-lg">{calcResult.score}</span>
                    <span className="text-slate-500"> / {calcResult.maxScore} ({calcResult.percentage.toFixed(0)}%)</span>
                  </div>
                  {calcResult.interpretation && (
                    <div className="text-slate-700">Interpretation: <span className="font-medium">{calcResult.interpretation}</span></div>
                  )}
                  {selectedDef.mcid > 0 && (
                    <div className="text-xs text-slate-500">MCID for {selectedDef.key}: {selectedDef.mcid} points</div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving || !calcResult} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Score'}
            </button>
          </div>
        </form>
      )}

      {/* Trend viewer */}
      {trendPatientId && trendMeasureKey && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">
              Trend: {trendPatient ? `${trendPatient.last_name}, ${trendPatient.first_name}` : ''} - {trendMeasureKey}
            </h3>
            <button onClick={() => { setTrendPatientId(''); setTrendMeasureKey(''); setTrendData([]); }} className="text-xs text-slate-400 underline">Close</button>
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
                const change = prev ? Math.round((pt.score - prev.score) * 100) / 100 : 0;
                const improved = trendDef?.higherIsBetter ? change > 0 : change < 0;
                const mcidMet = trendDef?.mcid ? Math.abs(change) >= trendDef.mcid : false;
                return (
                  <div key={`${pt.date}-${i}`} className="grid grid-cols-3 text-sm px-2 py-1 hover:bg-slate-50 rounded">
                    <span className="text-slate-600">{new Date(pt.date).toLocaleDateString()}</span>
                    <span className="text-center font-mono">
                      {pt.score}
                      {prev && (
                        <span className={`ml-1 text-xs ${improved ? 'text-green-600' : change === 0 ? 'text-slate-400' : 'text-red-500'}`}>
                          ({change > 0 ? '+' : ''}{change}{mcidMet ? '*' : ''})
                        </span>
                      )}
                    </span>
                    <span className="text-right font-mono text-slate-500">{Number(pt.percentage).toFixed(0)}%</span>
                  </div>
                );
              })}
              {trendDef?.mcid ? <div className="text-xs text-slate-400 mt-2 px-2">* Change meets or exceeds MCID ({trendDef.mcid})</div> : null}
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
          {definitions.map(d => <option key={d.key} value={d.key}>{d.key}</option>)}
        </select>
      </div>

      {/* Records list */}
      {records.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No outcome measures recorded yet.</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Patient</th>
                <th className="text-left px-4 py-3">Measure</th>
                <th className="text-center px-4 py-3">Score</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Interpretation</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">By</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map(m => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{m.patient_last_name}, {m.patient_first_name}</td>
                  <td className="px-4 py-3">
                    <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded-full">{m.measure_type}</span>
                  </td>
                  <td className="px-4 py-3 text-center font-mono">{m.score}<span className="text-slate-400">/{m.max_score}</span></td>
                  <td className="px-4 py-3 text-slate-500 hidden lg:table-cell">{m.interpretation || '-'}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(m.administered_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{m.administered_by_first_name} {m.administered_by_last_name}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => loadTrend(m.patient_id, m.measure_type)}
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
