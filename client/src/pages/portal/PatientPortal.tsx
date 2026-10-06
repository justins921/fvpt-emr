import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { portalApi, getPortalToken, clearPortalToken } from './portalApi';
import BookAppointment from './BookAppointment';
import PatientAppointments from './PatientAppointments';
import PatientIntakeForms from './PatientIntakeForms';
import PatientBilling from './PatientBilling';

function unwrapList(res: any): any[] {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.data)) return res.data;
  return [];
}

interface ProgramItem {
  id: string;
  exercise_id: string;
  sort_order: number;
  sets: number | null;
  reps: number | null;
  hold_seconds: number | null;
  duration_minutes: number | null;
  resistance: string | null;
  notes: string | null;
  exercise_name: string;
  exercise_description: string | null;
  exercise_instructions: string | null;
  body_region: string | null;
  category: string | null;
  difficulty: string | null;
  video_url: string | null;
  image_url: string | null;
}

interface Program {
  id: string;
  name: string;
  description: string | null;
  frequency: string | null;
  phase: string | null;
  start_date: string | null;
  end_date: string | null;
  item_count: number;
  items?: ProgramItem[];
}

interface AdherenceEntry {
  id: string;
  completed_at: string;
  completion_percent: number;
  pain_level: number | null;
  difficulty_rating: string | null;
  notes: string | null;
  exercises_completed: string[];
  logged_by_type: string;
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function exerciseRx(item: ProgramItem): string {
  const parts: string[] = [];
  if (item.sets) parts.push(`${item.sets} set${item.sets > 1 ? 's' : ''}`);
  if (item.reps) parts.push(`${item.reps} rep${item.reps > 1 ? 's' : ''}`);
  if (item.hold_seconds) parts.push(`hold ${item.hold_seconds}s`);
  if (item.duration_minutes) parts.push(`${item.duration_minutes} min`);
  if (item.resistance) parts.push(item.resistance);
  return parts.join(' × ');
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px min-h-[48px] whitespace-nowrap ${
        active
          ? 'border-primary-600 text-primary-700'
          : 'border-transparent text-slate-500'
      }`}
    >
      {label}
    </button>
  );
}

export default function PatientPortal() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'exercises' | 'booking' | 'appointments' | 'forms' | 'billing'>('exercises');
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!getPortalToken()) {
      navigate('/portal-login', { replace: true });
      return;
    }
    loadPrograms();
  }, []);

  async function loadPrograms() {
    setLoading(true);
    setError('');
    try {
      const data = await portalApi('/portal/patient/hep/my-programs');
      setPrograms(unwrapList(data));
    } catch (err: any) {
      if (/401|expired|invalid token/i.test(err.message)) {
        clearPortalToken();
        navigate('/portal-login', { replace: true });
        return;
      }
      setError(err.message || 'Could not load your exercise programs.');
    } finally {
      setLoading(false);
    }
  }

  function signOut() {
    clearPortalToken();
    navigate('/portal-login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900">Patient Portal</h1>
          <button onClick={signOut} className="text-sm text-slate-500 underline min-h-[44px] px-2">
            Sign out
          </button>
        </div>
        <div className="max-w-2xl mx-auto px-4 flex gap-1 overflow-x-auto">
          <TabButton active={tab === 'exercises'} onClick={() => setTab('exercises')} label="My Exercises" />
          <TabButton active={tab === 'booking'} onClick={() => setTab('booking')} label="Book Appointment" />
          <TabButton active={tab === 'appointments'} onClick={() => setTab('appointments')} label="Appointments" />
          <TabButton active={tab === 'forms'} onClick={() => setTab('forms')} label="Forms" />
          <TabButton active={tab === 'billing'} onClick={() => setTab('billing')} label="Billing" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4">
        {tab === 'booking' ? (
          <BookAppointment />
        ) : tab === 'appointments' ? (
          <PatientAppointments />
        ) : tab === 'forms' ? (
          <PatientIntakeForms />
        ) : tab === 'billing' ? (
          <PatientBilling />
        ) : loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2" role="alert">
            {error}
          </div>
        ) : selectedId ? (
          <ProgramDetail
            programId={selectedId}
            onBack={() => {
              setSelectedId(null);
              loadPrograms();
            }}
          />
        ) : programs.length === 0 ? (
          <div className="card text-center py-10">
            <p className="text-slate-600 font-medium">No exercise programs assigned yet</p>
            <p className="text-sm text-slate-400 mt-1">Your therapist will add one here when it's ready.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {programs.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className="card w-full text-left hover:shadow-md transition-shadow min-h-[64px]"
              >
                <div className="font-semibold text-slate-900">{p.name}</div>
                <div className="text-sm text-slate-500 mt-1">
                  {p.item_count} exercise{p.item_count === 1 ? '' : 's'}
                  {p.frequency ? ` · ${p.frequency}` : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ProgramDetail({ programId, onBack }: { programId: string; onBack: () => void }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showFinish, setShowFinish] = useState(false);
  const [pain, setPain] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [doneMsg, setDoneMsg] = useState('');
  const [history, setHistory] = useState<AdherenceEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    load();
  }, [programId]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [prog, hist] = await Promise.all([
        portalApi<Program>(`/portal/patient/hep/my-programs/${programId}`),
        portalApi(`/portal/patient/hep/my-programs/${programId}/adherence`),
      ]);
      setProgram(prog);
      setHistory(unwrapList(hist));
    } catch (err: any) {
      setError(err.message || 'Could not load this program.');
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitCheckoff() {
    if (checked.size === 0 || !program?.items) return;
    setSubmitting(true);
    setError('');
    try {
      const data = await portalApi<{
        completionPercent: number;
        exercisesCompleted: number;
        exercisesTotal: number;
      }>(`/portal/patient/hep/my-programs/${programId}/checkoff`, {
        method: 'POST',
        body: {
          exerciseIds: Array.from(checked),
          painLevel: pain === '' ? null : parseInt(pain, 10),
          difficulty: difficulty === '' ? null : parseInt(difficulty, 10),
          notes: notes.trim() || null,
        },
      });
      setDoneMsg(`Nice work! You completed ${data.exercisesCompleted} of ${data.exercisesTotal} exercises (${data.completionPercent}%).`);
      setChecked(new Set());
      setShowFinish(false);
      setPain('');
      setDifficulty('');
      setNotes('');
      const hist = await portalApi(`/portal/patient/hep/my-programs/${programId}/adherence`);
      setHistory(unwrapList(hist));
    } catch (err: any) {
      setError(err.message || 'Could not save your check-off.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }
  if (error && !program) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2 mt-3" role="alert">{error}</div>
      </div>
    );
  }
  if (!program) return null;

  const items = program.items || [];

  return (
    <div>
      <BackButton onBack={onBack} />
      <h2 className="text-xl font-bold text-slate-900 mt-2">{program.name}</h2>
      {program.description && <p className="text-sm text-slate-500 mt-1">{program.description}</p>}

      {doneMsg && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded px-3 py-2 mt-3" role="status">
          {doneMsg}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2 mt-3" role="alert">
          {error}
        </div>
      )}

      <p className="text-sm text-slate-500 mt-3 mb-2">Tap each exercise as you finish it:</p>
      <div className="space-y-3">
        {items.map((item) => {
          const isChecked = checked.has(item.id);
          return (
            <button
              key={item.id}
              onClick={() => toggle(item.id)}
              aria-pressed={isChecked}
              className={`w-full text-left rounded-lg border p-3 transition-colors min-h-[64px] ${
                isChecked ? 'border-green-500 bg-green-50' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex gap-3">
                <div
                  className={`mt-1 h-6 w-6 shrink-0 rounded-md border-2 flex items-center justify-center ${
                    isChecked ? 'border-green-600 bg-green-600 text-white' : 'border-slate-300 bg-white'
                  }`}
                  aria-hidden="true"
                >
                  {isChecked && <span className="text-sm font-bold">✓</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold ${isChecked ? 'text-green-800 line-through' : 'text-slate-900'}`}>
                    {item.exercise_name}
                  </div>
                  {exerciseRx(item) && (
                    <div className="text-sm text-primary-700 font-medium mt-0.5">{exerciseRx(item)}</div>
                  )}
                  {item.exercise_instructions && (
                    <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{item.exercise_instructions}</p>
                  )}
                  {item.notes && (
                    <p className="text-xs text-amber-700 mt-1">Note from your therapist: {item.notes}</p>
                  )}
                </div>
                {item.image_url && (
                  <img
                    src={item.image_url}
                    alt={item.exercise_name}
                    className="h-16 w-16 shrink-0 rounded object-cover"
                    loading="lazy"
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="sticky bottom-0 bg-slate-50 pt-3 pb-4 mt-4">
        {!showFinish ? (
          <button
            onClick={() => setShowFinish(true)}
            disabled={checked.size === 0}
            className="btn-primary w-full min-h-[52px] text-base disabled:opacity-40"
          >
            Finish session ({checked.size}/{items.length})
          </button>
        ) : (
          <div className="card space-y-4">
            <h3 className="font-semibold text-slate-900">
              Log session — {checked.size} of {items.length} exercises
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="ck-pain">Pain (0–10, optional)</label>
                <input
                  id="ck-pain"
                  type="number"
                  min={0}
                  max={10}
                  inputMode="numeric"
                  className="input"
                  value={pain}
                  onChange={(e) => setPain(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="label" htmlFor="ck-diff">Difficulty (1–5, optional)</label>
                <input
                  id="ck-diff"
                  type="number"
                  min={1}
                  max={5}
                  inputMode="numeric"
                  className="input"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  placeholder="3"
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="ck-notes">Notes (optional)</label>
              <textarea
                id="ck-notes"
                className="input"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything your therapist should know…"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowFinish(false)} className="btn-secondary flex-1 min-h-[48px]">
                Back
              </button>
              <button onClick={submitCheckoff} disabled={submitting} className="btn-primary flex-1 min-h-[48px]">
                {submitting ? 'Saving…' : 'Save check-off'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6">
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="text-sm text-primary-700 underline min-h-[44px]"
        >
          {showHistory ? 'Hide' : 'Show'} past sessions ({history.length})
        </button>
        {showHistory && (
          <div className="space-y-2 mt-2">
            {history.length === 0 ? (
              <p className="text-sm text-slate-400">No sessions logged yet.</p>
            ) : (
              history.map((h) => (
                <div key={h.id} className="card py-2">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-slate-900">{h.completion_percent}% complete</span>
                    <span className="text-xs text-slate-400">{fmtDateTime(h.completed_at)}</span>
                  </div>
                  {(h.pain_level != null || h.difficulty_rating) && (
                    <div className="text-xs text-slate-500 mt-1">
                      {h.pain_level != null && `Pain ${h.pain_level}/10`}
                      {h.pain_level != null && h.difficulty_rating && ' · '}
                      {h.difficulty_rating && `Difficulty ${h.difficulty_rating}/5`}
                    </div>
                  )}
                  {h.notes && <p className="text-xs text-slate-500 mt-1">{h.notes}</p>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="text-sm text-primary-700 underline min-h-[44px]">
      ← All programs
    </button>
  );
}
