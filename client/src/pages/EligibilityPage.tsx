import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  mrn: string;
  date_of_birth: string;
}

interface InsuranceInfo {
  payer_name: string;
  member_id: string;
  group_number: string | null;
  plan_type: string | null;
  effective_date: string | null;
  termination_date: string | null;
}

interface EligibilityResult {
  id: string;
  patient_id: string;
  status: 'eligible' | 'ineligible' | 'unknown';
  checked_at: string;
  checked_by_name: string | null;
  source: 'electronic' | 'manual';
  payer_name: string | null;
  copay_cents: number | null;
  deductible_cents: number | null;
  deductible_met_cents: number | null;
  coinsurance_pct: number | null;
  oop_max_cents: number | null;
  oop_met_cents: number | null;
  pt_visits_allowed: number | null;
  pt_visits_used: number | null;
  auth_required: boolean;
  auth_number: string | null;
  notes: string | null;
}

export default function EligibilityPage() {
  const { user } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [insurance, setInsurance] = useState<InsuranceInfo | null>(null);
  const [latestResult, setLatestResult] = useState<EligibilityResult | null>(null);
  const [history, setHistory] = useState<EligibilityResult[]>([]);
  const [loadingPatient, setLoadingPatient] = useState(false);

  const [checking, setChecking] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [submittingManual, setSubmittingManual] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(() => searchPatients(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  async function searchPatients(q: string) {
    setSearching(true);
    try {
      const res = await api.get<any>(`/patients?search=${encodeURIComponent(q)}&limit=10`);
      setSearchResults(res.data || []);
    } catch {} finally {
      setSearching(false);
    }
  }

  async function selectPatient(patient: Patient) {
    setSelectedPatient(patient);
    setSearchQuery('');
    setSearchResults([]);
    setLoadingPatient(true);
    setError('');
    setShowManualForm(false);
    try {
      const [insRes, eligRes] = await Promise.all([
        api.get<any>(`/patients/${patient.id}/insurance`),
        api.get<any>(`/eligibility/patient/${patient.id}`),
      ]);
      setInsurance(insRes.data || null);
      const checks: EligibilityResult[] = eligRes.data || [];
      setHistory(checks);
      setLatestResult(checks.length > 0 ? checks[0] : null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setInsurance(null);
        setHistory([]);
        setLatestResult(null);
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to load patient data');
      }
    } finally {
      setLoadingPatient(false);
    }
  }

  async function runEligibilityCheck() {
    if (!selectedPatient) return;
    setChecking(true);
    setError('');
    try {
      const res = await api.post<any>(`/eligibility/check`, {
        patientId: selectedPatient.id,
      });
      setLatestResult(res.data);
      setHistory(prev => [res.data, ...prev]);
      setSuccess('Eligibility check completed');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Eligibility check failed');
    } finally {
      setChecking(false);
    }
  }

  async function handleManualEntry(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedPatient) return;
    setSubmittingManual(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    try {
      const res = await api.post<any>(`/eligibility/manual`, {
        patientId: selectedPatient.id,
        status: fd.get('status'),
        payerName: fd.get('payerName') || undefined,
        copayCents: fd.get('copay') ? Math.round(parseFloat(fd.get('copay') as string) * 100) : undefined,
        deductibleCents: fd.get('deductible') ? Math.round(parseFloat(fd.get('deductible') as string) * 100) : undefined,
        deductibleMetCents: fd.get('deductibleMet') ? Math.round(parseFloat(fd.get('deductibleMet') as string) * 100) : undefined,
        coinsurancePct: fd.get('coinsurance') ? parseFloat(fd.get('coinsurance') as string) : undefined,
        oopMaxCents: fd.get('oopMax') ? Math.round(parseFloat(fd.get('oopMax') as string) * 100) : undefined,
        oopMetCents: fd.get('oopMet') ? Math.round(parseFloat(fd.get('oopMet') as string) * 100) : undefined,
        ptVisitsAllowed: fd.get('visitsAllowed') ? parseInt(fd.get('visitsAllowed') as string) : undefined,
        ptVisitsUsed: fd.get('visitsUsed') ? parseInt(fd.get('visitsUsed') as string) : undefined,
        authRequired: fd.get('authRequired') === 'yes',
        authNumber: fd.get('authNumber') || undefined,
        notes: fd.get('notes') || undefined,
      });
      setLatestResult(res.data);
      setHistory(prev => [res.data, ...prev]);
      setShowManualForm(false);
      setSuccess('Manual eligibility entry saved');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save manual entry');
    } finally {
      setSubmittingManual(false);
    }
  }

  function dollars(cents: number | null): string {
    if (cents === null || cents === undefined) return '--';
    return `$${(cents / 100).toFixed(2)}`;
  }

  function statusIndicator(status: string) {
    if (status === 'eligible') return 'bg-green-100 text-green-700 border-green-300';
    if (status === 'ineligible') return 'bg-red-100 text-red-700 border-red-300';
    return 'bg-yellow-100 text-yellow-700 border-yellow-300';
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Eligibility Verification</h1>
        <p className="text-sm text-slate-500 mt-1">Check insurance eligibility and benefits for patients</p>
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

      {/* Patient Search */}
      <div className="card">
        <label className="label">Search Patient</label>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="input"
          placeholder="Type patient name or MRN..."
        />
        {searching && <div className="text-sm text-slate-400 mt-2">Searching...</div>}
        {searchResults.length > 0 && (
          <div className="border rounded-lg divide-y max-h-48 overflow-y-auto mt-2">
            {searchResults.map(p => (
              <button
                key={p.id}
                onClick={() => selectPatient(p)}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm flex justify-between items-center"
              >
                <span className="font-medium">{p.last_name}, {p.first_name}</span>
                <span className="text-slate-400 text-xs">MRN: {p.mrn} | DOB: {new Date(p.date_of_birth).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Patient Selected */}
      {selectedPatient && (
        <>
          {loadingPatient ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : (
            <>
              {/* Patient + Insurance Header */}
              <div className="card">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {selectedPatient.last_name}, {selectedPatient.first_name}
                    </h2>
                    <div className="text-sm text-slate-500 mt-1">
                      MRN: {selectedPatient.mrn} | DOB: {new Date(selectedPatient.date_of_birth).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={runEligibilityCheck}
                      disabled={checking}
                      className="btn-primary text-sm"
                    >
                      {checking ? (
                        <span className="flex items-center gap-2">
                          <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                          Checking...
                        </span>
                      ) : 'Run Eligibility Check'}
                    </button>
                    <button
                      onClick={() => setShowManualForm(!showManualForm)}
                      className="btn-secondary text-sm"
                    >
                      Manual Entry
                    </button>
                  </div>
                </div>

                {/* Insurance Info */}
                {insurance ? (
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    <div>
                      <span className="text-slate-500">Payer:</span>{' '}
                      <span className="font-medium">{insurance.payer_name}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Member ID:</span>{' '}
                      <span className="font-mono">{insurance.member_id}</span>
                    </div>
                    {insurance.group_number && (
                      <div>
                        <span className="text-slate-500">Group:</span>{' '}
                        <span className="font-mono">{insurance.group_number}</span>
                      </div>
                    )}
                    {insurance.plan_type && (
                      <div>
                        <span className="text-slate-500">Plan:</span>{' '}
                        <span>{insurance.plan_type}</span>
                      </div>
                    )}
                    {insurance.effective_date && (
                      <div>
                        <span className="text-slate-500">Effective:</span>{' '}
                        <span>{new Date(insurance.effective_date).toLocaleDateString()}</span>
                      </div>
                    )}
                    {insurance.termination_date && (
                      <div>
                        <span className="text-slate-500">Terminates:</span>{' '}
                        <span>{new Date(insurance.termination_date).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 text-sm text-slate-400">No insurance information on file</div>
                )}
              </div>

              {/* Manual Entry Form */}
              {showManualForm && (
                <form onSubmit={handleManualEntry} className="card space-y-4">
                  <h3 className="font-semibold">Manual Eligibility Entry</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="label">Status *</label>
                      <select name="status" required className="input">
                        <option value="eligible">Eligible</option>
                        <option value="ineligible">Ineligible</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Payer Name</label>
                      <input name="payerName" className="input" defaultValue={insurance?.payer_name || ''} />
                    </div>
                    <div>
                      <label className="label">Copay ($)</label>
                      <input name="copay" type="number" step="0.01" min="0" className="input" placeholder="0.00" />
                    </div>
                    <div>
                      <label className="label">Deductible ($)</label>
                      <input name="deductible" type="number" step="0.01" min="0" className="input" placeholder="0.00" />
                    </div>
                    <div>
                      <label className="label">Deductible Met ($)</label>
                      <input name="deductibleMet" type="number" step="0.01" min="0" className="input" placeholder="0.00" />
                    </div>
                    <div>
                      <label className="label">Coinsurance (%)</label>
                      <input name="coinsurance" type="number" step="1" min="0" max="100" className="input" placeholder="20" />
                    </div>
                    <div>
                      <label className="label">OOP Max ($)</label>
                      <input name="oopMax" type="number" step="0.01" min="0" className="input" placeholder="0.00" />
                    </div>
                    <div>
                      <label className="label">OOP Met ($)</label>
                      <input name="oopMet" type="number" step="0.01" min="0" className="input" placeholder="0.00" />
                    </div>
                    <div>
                      <label className="label">PT Visits Allowed</label>
                      <input name="visitsAllowed" type="number" min="0" className="input" placeholder="e.g. 30" />
                    </div>
                    <div>
                      <label className="label">PT Visits Used</label>
                      <input name="visitsUsed" type="number" min="0" className="input" placeholder="e.g. 5" />
                    </div>
                    <div>
                      <label className="label">Auth Required?</label>
                      <select name="authRequired" className="input">
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Auth Number</label>
                      <input name="authNumber" className="input" placeholder="Authorization #" />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="label">Notes</label>
                      <textarea name="notes" className="input" rows={2} placeholder="Additional notes..." />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowManualForm(false)} className="btn-secondary">Cancel</button>
                    <button type="submit" disabled={submittingManual} className="btn-primary">
                      {submittingManual ? 'Saving...' : 'Save Entry'}
                    </button>
                  </div>
                </form>
              )}

              {/* Latest Result */}
              {latestResult && (
                <div className={`card border-2 ${statusIndicator(latestResult.status)}`}>
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                    <div className="flex items-center gap-3">
                      <span className={`inline-block px-3 py-1 text-sm rounded-full font-semibold ${statusIndicator(latestResult.status)}`}>
                        {latestResult.status.toUpperCase()}
                      </span>
                      {latestResult.payer_name && (
                        <span className="text-sm text-slate-600">{latestResult.payer_name}</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      {latestResult.source === 'manual' ? 'Manual entry' : 'Electronic check'} on{' '}
                      {new Date(latestResult.checked_at).toLocaleString()}
                      {latestResult.checked_by_name && ` by ${latestResult.checked_by_name}`}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    <div className="text-center">
                      <div className="text-xs text-slate-500 mb-1">Copay</div>
                      <div className="text-lg font-bold">{dollars(latestResult.copay_cents)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-500 mb-1">Deductible</div>
                      <div className="text-lg font-bold">{dollars(latestResult.deductible_cents)}</div>
                      {latestResult.deductible_met_cents !== null && (
                        <div className="text-xs text-slate-400">Met: {dollars(latestResult.deductible_met_cents)}</div>
                      )}
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-500 mb-1">Coinsurance</div>
                      <div className="text-lg font-bold">
                        {latestResult.coinsurance_pct !== null ? `${latestResult.coinsurance_pct}%` : '--'}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-500 mb-1">OOP Max</div>
                      <div className="text-lg font-bold">{dollars(latestResult.oop_max_cents)}</div>
                      {latestResult.oop_met_cents !== null && (
                        <div className="text-xs text-slate-400">Met: {dollars(latestResult.oop_met_cents)}</div>
                      )}
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-500 mb-1">PT Visits</div>
                      <div className="text-lg font-bold">
                        {latestResult.pt_visits_used !== null && latestResult.pt_visits_allowed !== null
                          ? `${latestResult.pt_visits_used} / ${latestResult.pt_visits_allowed}`
                          : latestResult.pt_visits_allowed !== null
                            ? `-- / ${latestResult.pt_visits_allowed}`
                            : '--'}
                      </div>
                      {latestResult.pt_visits_allowed !== null && latestResult.pt_visits_used !== null && (
                        <div className="w-full bg-slate-200 rounded-full h-1.5 mt-1">
                          <div
                            className={`h-1.5 rounded-full ${latestResult.pt_visits_used >= latestResult.pt_visits_allowed ? 'bg-red-500' : 'bg-green-500'}`}
                            style={{ width: `${Math.min(100, (latestResult.pt_visits_used / latestResult.pt_visits_allowed) * 100)}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  </div>

                  {latestResult.auth_required && (
                    <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-sm">
                      <span className="font-medium text-yellow-700">Authorization Required</span>
                      {latestResult.auth_number && (
                        <span className="text-yellow-600 ml-2">Auth #: {latestResult.auth_number}</span>
                      )}
                    </div>
                  )}

                  {latestResult.notes && (
                    <div className="mt-3 text-sm text-slate-600">
                      <span className="font-medium">Notes:</span> {latestResult.notes}
                    </div>
                  )}
                </div>
              )}

              {/* History */}
              {history.length > 1 && (
                <div className="card">
                  <h3 className="font-semibold mb-3">Verification History</h3>
                  <div className="space-y-2">
                    {history.slice(1).map(h => (
                      <div
                        key={h.id}
                        className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                        onClick={() => setLatestResult(h)}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${statusIndicator(h.status)}`}>
                            {h.status}
                          </span>
                          <span className="text-slate-600">{h.payer_name || 'Unknown payer'}</span>
                          <span className="text-xs text-slate-400">
                            {h.source === 'manual' ? 'Manual' : 'Electronic'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {new Date(h.checked_at).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
