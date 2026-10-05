import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface Exercise {
  id: string;
  name: string;
  base_name?: string;
  description: string;
  body_region: string;
  category: string;
  difficulty: string;
  instructions: string;
  default_sets: number;
  default_reps: number;
  default_hold_seconds: number;
  image_url?: string;
  video_url?: string;
  is_customized?: boolean;
  is_active: boolean;
}

interface Program {
  id: string;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  name: string;
  status: string;
  exercise_count: number;
  assigned_by_name: string;
  created_at: string;
}

interface ProgramExercise {
  exercise_id: string;
  name: string;
  sets: number;
  reps: number;
  hold_seconds: number;
  order: number;
  notes: string;
}

type Tab = 'exercises' | 'programs';

const BODY_REGIONS = [
  { label: 'Cervical', value: 'cervical' },
  { label: 'Shoulder', value: 'shoulder' },
  { label: 'Elbow/Wrist', value: 'elbow_wrist' },
  { label: 'Thoracic', value: 'thoracic' },
  { label: 'Lumbar', value: 'lumbar' },
  { label: 'Hip', value: 'hip' },
  { label: 'Knee', value: 'knee' },
  { label: 'Ankle/Foot', value: 'ankle_foot' },
  { label: 'Full Body', value: 'full_body' },
];
const CATEGORIES = [
  { label: 'Strengthening', value: 'strengthening' },
  { label: 'Stretching', value: 'stretching' },
  { label: 'Balance', value: 'balance' },
  { label: 'ROM', value: 'rom' },
  { label: 'Cardiovascular', value: 'cardio' },
  { label: 'Functional', value: 'functional' },
  { label: 'Neuromuscular', value: 'neuromuscular' },
];
const DIFFICULTIES = [
  { label: 'Beginner', value: 'beginner' },
  { label: 'Moderate', value: 'moderate' },
  { label: 'Advanced', value: 'advanced' },
];

const regionLabel = (val: string) => BODY_REGIONS.find(r => r.value === val)?.label || val;
const categoryLabel = (val: string) => CATEGORIES.find(c => c.value === val)?.label || val;

export default function HEPPage() {
  const [tab, setTab] = useState<Tab>('exercises');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Home Exercise Programs</h1>
          <p className="text-sm text-slate-500 mt-1">Exercise library and patient HEP management</p>
        </div>
      </div>
      <div className="flex gap-1 border-b">
        {([['exercises', 'Exercises'], ['programs', 'Programs']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={'px-4 py-2 text-sm font-medium border-b-2 -mb-px ' + (tab === key ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'exercises' ? <ExerciseLibrary /> : <ProgramList />}
    </div>
  );
}

function ExerciseLibrary() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customizing, setCustomizing] = useState<Exercise | null>(null);
  const [showHandout, setShowHandout] = useState(false);
  const [showSms, setShowSms] = useState(false);

  useEffect(() => { loadExercises(); }, [search, regionFilter, categoryFilter]);

  async function loadExercises() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (regionFilter) params.set('body_region', regionFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      params.set('limit', '100');
      const qs = params.toString() ? '?' + params : '';
      const res = await api.get<any>('/exercises' + qs);
      setExercises(res.data || []);
    } catch {} finally { setLoading(false); }
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: fd.get('name') as string,
      bodyRegion: fd.get('bodyRegion') as string,
      category: fd.get('category') as string,
      difficulty: fd.get('difficulty') as string,
      instructions: fd.get('instructions') as string,
      defaultSets: Number(fd.get('sets')) || 3,
      defaultReps: Number(fd.get('reps')) || 10,
      defaultHoldSeconds: Number(fd.get('holdSeconds')) || 0,
      imageUrl: (fd.get('imageUrl') as string) || null,
    };
    try {
      if (editing) {
        await api.put('/exercises/' + editing.id, payload);
      } else {
        await api.post('/exercises', payload);
      }
      setShowForm(false);
      setEditing(null);
      loadExercises();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to save exercise');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this exercise?')) return;
    try {
      await api.delete('/exercises/' + id);
      loadExercises();
    } catch {}
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedExercises = exercises.filter(ex => selected.has(ex.id));

  const difficultyColor = (d: string) => {
    switch (d?.toLowerCase()) {
      case 'beginner': return 'bg-green-100 text-green-700';
      case 'moderate': return 'bg-yellow-100 text-yellow-700';
      case 'advanced': return 'bg-red-100 text-red-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="search" placeholder="Search exercises..." value={search}
          onChange={e => setSearch(e.target.value)}
          className="input flex-1"
        />
        <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} className="input max-w-[180px]">
          <option value="">All Regions</option>
          {BODY_REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="input max-w-[180px]">
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary whitespace-nowrap">+ Add Exercise</button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="label">Name *</label>
            <input name="name" required className="input" defaultValue={editing?.name || ''} />
          </div>
          <div>
            <label className="label">Body Region *</label>
            <select name="bodyRegion" required className="input" defaultValue={editing?.body_region || ''}>
              <option value="">Select...</option>
              {BODY_REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Category *</label>
            <select name="category" required className="input" defaultValue={editing?.category || ''}>
              <option value="">Select...</option>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Difficulty *</label>
            <select name="difficulty" required className="input" defaultValue={editing?.difficulty || 'beginner'}>
              {DIFFICULTIES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Sets</label>
            <input name="sets" type="number" min={1} className="input" defaultValue={editing?.default_sets || 3} />
          </div>
          <div>
            <label className="label">Reps</label>
            <input name="reps" type="number" min={1} className="input" defaultValue={editing?.default_reps || 10} />
          </div>
          <div>
            <label className="label">Hold (sec)</label>
            <input name="holdSeconds" type="number" min={0} className="input" defaultValue={editing?.default_hold_seconds || 0} />
          </div>
          <div>
            <label className="label">Image URL</label>
            <input name="imageUrl" className="input" placeholder="https://..." defaultValue={editing?.image_url || ''} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Instructions</label>
            <textarea name="instructions" rows={2} className="input" defaultValue={editing?.instructions || ''} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? 'Update' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
      ) : exercises.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No exercises found. Add one to build your library.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {exercises.map(ex => (
            <div key={ex.id} className="card">
              <div className="flex items-start gap-2 mb-2">
                <input
                  type="checkbox" checked={selected.has(ex.id)} onChange={() => toggleSelect(ex.id)}
                  className="mt-1 h-4 w-4 shrink-0" title="Select for handout"
                />
                {ex.image_url ? (
                  <img src={ex.image_url} alt={ex.name} className="w-20 h-20 object-cover rounded-lg shrink-0 bg-slate-50" loading="lazy" />
                ) : (
                  <div className="w-20 h-20 rounded-lg bg-slate-100 shrink-0 flex items-center justify-center text-slate-300 text-[10px] text-center px-1">No image</div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm leading-tight">{ex.name}</h3>
                  {ex.is_customized && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Your name</span>}
                </div>
                <span className={'text-xs px-2 py-0.5 rounded-full shrink-0 ' + difficultyColor(ex.difficulty)}>{ex.difficulty}</span>
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <div>Region: <span className="text-slate-700">{regionLabel(ex.body_region)}</span></div>
                <div>Category: <span className="text-slate-700">{categoryLabel(ex.category)}</span></div>
                <div>{ex.default_sets || 3}x{ex.default_reps || 10}{(ex.default_hold_seconds || 0) > 0 ? ', ' + ex.default_hold_seconds + 's hold' : ''}</div>
              </div>
              {ex.description && <p className="text-xs text-slate-600 mt-2 line-clamp-2">{ex.description}</p>}
              {ex.instructions && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{ex.instructions}</p>}
              <div className="flex gap-3 mt-3">
                <button onClick={() => { setEditing(ex); setShowForm(true); }} className="text-xs text-primary-600 underline">Edit</button>
                <button onClick={() => setCustomizing(ex)} className="text-xs text-purple-600 underline">Rename</button>
                <button onClick={() => handleDelete(ex.id)} className="text-xs text-red-500 underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-full pl-4 pr-2 py-2 flex items-center gap-2 shadow-xl">
          <span className="text-sm whitespace-nowrap">{selected.size} selected</span>
          <button onClick={() => setShowHandout(true)} className="text-sm bg-white text-slate-900 rounded-full px-3 py-1 font-medium">Print handout</button>
          <button onClick={() => setShowSms(true)} className="text-sm bg-primary-600 text-white rounded-full px-3 py-1 font-medium">Send via SMS</button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-slate-300 px-2">Clear</button>
        </div>
      )}

      {customizing && (
        <CustomizeModal
          exercise={customizing}
          onClose={() => setCustomizing(null)}
          onSaved={() => { setCustomizing(null); loadExercises(); }}
        />
      )}
      {showHandout && selectedExercises.length > 0 && (
        <HandoutView exercises={selectedExercises} onClose={() => setShowHandout(false)} />
      )}
      {showSms && selectedExercises.length > 0 && (
        <SendSmsModal exercises={selectedExercises} onClose={() => setShowSms(false)} onSent={() => { setShowSms(false); setSelected(new Set()); }} />
      )}
    </div>
  );
}

function CustomizeModal({ exercise, onClose, onSaved }: { exercise: Exercise; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  // Two-click confirm: armed state persists until the dialog closes (no timeout),
  // so keyboard and assistive-tech users are never rushed. State is discarded on unmount.
  const [confirmReset, setConfirmReset] = useState(false);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const customName = (fd.get('customName') as string).trim();
    const customImageUrl = (fd.get('customImageUrl') as string).trim();
    const customDescription = (fd.get('customDescription') as string).trim();
    if (!customName) { alert('Name is required'); return; }
    setSaving(true);
    try {
      await api.put('/exercises/' + exercise.id + '/override', {
        customName,
        customImageUrl: customImageUrl || null,
        customDescription: customDescription || null,
      });
      onSaved();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirmReset) { setConfirmReset(true); return; }
    try {
      await api.delete('/exercises/' + exercise.id + '/override');
      onSaved();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to reset');
      setConfirmReset(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={handleSave} onClick={e => e.stopPropagation()} className="card w-full max-w-md space-y-3">
        <h3 className="font-semibold">Rename exercise</h3>
        <p className="text-xs text-slate-500">Only your clinic sees this. Other clinics keep the shared default{exercise.base_name ? ' ("' + exercise.base_name + '")' : ''}.</p>
        <div>
          <label className="label">Your name for this exercise *</label>
          <input name="customName" required className="input" defaultValue={exercise.name} />
        </div>
        <div>
          <label className="label">Your image URL <span className="text-slate-400">(blank = use default)</span></label>
          <input name="customImageUrl" className="input" placeholder="https://..." defaultValue="" />
        </div>
        <div>
          <label className="label">Your description <span className="text-slate-400">(blank = use default)</span></label>
          <textarea name="customDescription" rows={2} className="input" defaultValue="" />
        </div>
        <div className="flex gap-2 justify-between pt-1">
          <div>
            {exercise.is_customized && (
              <button
                type="button"
                onClick={handleReset}
                aria-live="polite"
                className={confirmReset ? "text-xs font-semibold text-red-600 underline" : "text-xs text-slate-500 underline"}
              >
                {confirmReset ? "Click again to confirm reset" : "Reset to default"}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function HandoutView({ exercises, onClose }: { exercises: Exercise[]; onClose: () => void }) {
  const [patientName, setPatientName] = useState('');
  const today = new Date().toLocaleDateString();

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-auto">
      <style>{'@media print { body * { visibility: hidden; } #hep-handout, #hep-handout * { visibility: visible; } #hep-handout { position: absolute; left: 0; top: 0; width: 100%; } }'}</style>
      <div className="print:hidden sticky top-0 bg-white border-b px-4 py-3 flex items-center gap-3 z-10">
        <input
          value={patientName} onChange={e => setPatientName(e.target.value)}
          placeholder="Patient name (optional)" className="input max-w-xs"
        />
        <button onClick={() => window.print()} className="btn-primary">Print</button>
        <button onClick={onClose} className="btn-secondary">Close</button>
      </div>
      <div id="hep-handout" className="max-w-3xl mx-auto p-6">
        <div className="border-b-2 border-slate-900 pb-3 mb-4">
          <h1 className="text-2xl font-bold">Home Exercise Program</h1>
          <div className="text-sm text-slate-600 mt-1 flex gap-6">
            {patientName && <span>Patient: <strong>{patientName}</strong></span>}
            <span>Date: {today}</span>
          </div>
        </div>
        <div className="space-y-5">
          {exercises.map((ex, i) => (
            <div key={ex.id} className="flex gap-4 pb-5 border-b border-slate-200 break-inside-avoid">
              <div className="text-lg font-bold text-slate-400 w-6 shrink-0">{i + 1}</div>
              {ex.image_url && <img src={ex.image_url} alt={ex.name} className="w-36 h-36 object-cover rounded-lg shrink-0" />}
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-base">{ex.name}</h2>
                <p className="text-sm text-slate-700 font-medium mt-0.5">
                  {ex.default_sets || 3} sets x {ex.default_reps || 10} reps{(ex.default_hold_seconds || 0) > 0 ? ', hold ' + ex.default_hold_seconds + 's' : ''}
                </p>
                {ex.instructions && <p className="text-sm text-slate-600 mt-1">{ex.instructions}</p>}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-6">Stop any exercise that causes sharp pain and contact your provider with questions.</p>
      </div>
    </div>
  );
}

function SendSmsModal({ exercises, onClose, onSent }: { exercises: Exercise[]; onClose: () => void; onSent: () => void }) {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [sendError, setSendError] = useState('');

  useEffect(() => { loadPatients(); }, []);

  async function loadPatients() {
    try {
      const res = await api.get<any>('/patients?limit=100');
      const list = res.data || [];
      setPatients(Array.isArray(list) ? list : []);
    } catch {}
  }

  const clinicName = (user as any)?.clinicName || (user as any)?.clinic_name || 'your clinic';
  const lines = exercises.map((ex, i) => (i + 1) + '. ' + ex.name + ' - ' + (ex.default_sets || 3) + 'x' + (ex.default_reps || 10) + ((ex.default_hold_seconds || 0) > 0 ? ', ' + ex.default_hold_seconds + 's hold' : ''));
  const body = 'Your home exercises from ' + clinicName + ':\n\n' + lines.join('\n');
  const filtered = query
    ? patients.filter((p: any) => (p.first_name + ' ' + p.last_name).toLowerCase().includes(query.toLowerCase()))
    : patients;

  async function handleSend() {
    if (!selectedPatient) return;
    if (body.length > 1600) { alert('Message too long (' + body.length + ' chars). Select fewer exercises.'); return; }
    setSending(true);
    setSendError('');
    try {
      const res = await api.post<any>('/messaging/send', { patientId: selectedPatient.id, body, messageType: 'manual' });
      const d = res.data || res || {};
      if (d.smsDelivered) setResult('Sent to ' + selectedPatient.first_name + ' ' + selectedPatient.last_name + '.');
      else if (d.smsConfigured === false) setResult('Saved (SMS provider not configured yet — message is queued).');
      else setResult('Message saved but SMS failed to deliver.');
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="card w-full max-w-md space-y-3">
        <h3 className="font-semibold">Send {exercises.length} exercise{exercises.length !== 1 ? 's' : ''} via SMS</h3>
        {sendError && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{sendError}</p>}
        {result ? (
          <div className="space-y-3">
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{result}</p>
            <div className="flex justify-end">
              <button type="button" onClick={onSent} className="btn-primary">Done</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <input type="search" placeholder="Search patient..." value={query} onChange={e => setQuery(e.target.value)} className="input" />
            <div className="border rounded-lg max-h-40 overflow-y-auto divide-y">
              {filtered.slice(0, 20).map((p: any) => (
                <button
                  key={p.id} type="button"
                  onClick={() => setSelectedPatient(p)}
                  className={'w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ' + (selectedPatient?.id === p.id ? 'bg-primary-50 font-medium' : '')}
                >
                  {p.last_name}, {p.first_name}
                  {!p.phone && <span className="text-red-400 text-xs ml-2">no phone</span>}
                </button>
              ))}
              {filtered.length === 0 && <div className="p-3 text-sm text-slate-400 text-center">No patients found</div>}
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 whitespace-pre-wrap max-h-40 overflow-y-auto">{body}</div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
              <button onClick={handleSend} disabled={!selectedPatient || sending} className="btn-primary">{sending ? 'Sending...' : 'Send SMS'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgramList() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedExercises, setSelectedExercises] = useState<ProgramExercise[]>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryExercises, setLibraryExercises] = useState<Exercise[]>([]);
  const [builderError, setBuilderError] = useState('');

  useEffect(() => { loadPrograms(); }, []);

  async function loadPrograms() {
    setLoading(true);
    try {
      const res = await api.get<any>('/exercises/programs');
      setPrograms(res.data || []);
    } catch {} finally { setLoading(false); }
  }

  async function openBuilder() {
    try {
      const [exRes, ptRes] = await Promise.all([
        api.get<any>('/exercises?limit=500'),
        api.get<any>('/patients?limit=200'),
      ]);
      setLibraryExercises(exRes.data || []);
      setPatients(ptRes.data || []);
      setSelectedExercises([]);
      setBuilderError('');
      setShowBuilder(true);
    } catch {}
  }

  function addExercise(ex: Exercise) {
    if (selectedExercises.find(s => s.exercise_id === ex.id)) return;
    setSelectedExercises(prev => [...prev, {
      exercise_id: ex.id, name: ex.name,
      sets: ex.default_sets || 3, reps: ex.default_reps || 10, hold_seconds: ex.default_hold_seconds || 0,
      order: prev.length + 1, notes: '',
    }]);
  }

  function removeExercise(exerciseId: string) {
    setSelectedExercises(prev => prev.filter(e => e.exercise_id !== exerciseId).map((e, i) => ({ ...e, order: i + 1 })));
  }

  async function handleCreateProgram(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBuilderError('');
    const fd = new FormData(e.currentTarget);
    try {
      await api.post('/exercises/programs', {
        patientId: fd.get('patientId'),
        name: fd.get('name'),
        items: selectedExercises.map(({ exercise_id, sets, reps, hold_seconds, order, notes }) => ({
          exerciseId: exercise_id, sortOrder: order, sets, reps, holdSeconds: hold_seconds, notes,
        })),
      });
      setShowBuilder(false);
      setSelectedExercises([]);
      loadPrograms();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to create program';
      setBuilderError(msg);
    }
  }

  async function updateProgramStatus(id: string, status: string) {
    try {
      await api.put('/exercises/programs/' + id, { status });
      loadPrograms();
    } catch {}
  }

  const filteredLibrary = librarySearch
    ? libraryExercises.filter(ex => ex.name.toLowerCase().includes(librarySearch.toLowerCase()) || ex.body_region.toLowerCase().includes(librarySearch.toLowerCase()))
    : libraryExercises;

  const statusColor = (s: string) => {
    switch (s) {
      case 'active': return 'bg-green-100 text-green-700';
      case 'completed': return 'bg-blue-100 text-blue-700';
      case 'archived': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-slate-500">{programs.length} program{programs.length !== 1 ? 's' : ''}</span>
        <button onClick={openBuilder} className="btn-primary">+ New Program</button>
      </div>

      {showBuilder && (
        <form onSubmit={handleCreateProgram} className="card space-y-4">
          <h3 className="font-semibold">Build HEP</h3>
          {builderError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{builderError}</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Patient *</label>
              <select name="patientId" required className="input">
                <option value="">Select patient...</option>
                {patients.map((p: any) => <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Program Name *</label>
              <input name="name" required className="input" placeholder="e.g., Post-op Knee Phase 1" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="label">Exercise Library</label>
              <input
                type="search" placeholder="Search library..." value={librarySearch}
                onChange={e => setLibrarySearch(e.target.value)} className="input mb-2"
              />
              <div className="border rounded-lg max-h-48 overflow-y-auto divide-y">
                {filteredLibrary.length === 0 ? (
                  <div className="p-3 text-sm text-slate-400 text-center">No exercises found</div>
                ) : filteredLibrary.map(ex => (
                  <button
                    type="button" key={ex.id}
                    onClick={() => addExercise(ex)}
                    disabled={!!selectedExercises.find(s => s.exercise_id === ex.id)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm flex justify-between items-center disabled:opacity-40"
                  >
                    <span>{ex.name}</span>
                    <span className="text-xs text-slate-400">{regionLabel(ex.body_region)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Selected ({selectedExercises.length})</label>
              {selectedExercises.length === 0 ? (
                <div className="border rounded-lg p-4 text-sm text-slate-400 text-center">Add exercises from the library</div>
              ) : (
                <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                  {selectedExercises.map((se, i) => (
                    <div key={se.exercise_id} className="px-3 py-2 flex items-center justify-between text-sm">
                      <span>{i + 1}. {se.name} ({se.sets}x{se.reps})</span>
                      <button type="button" onClick={() => removeExercise(se.exercise_id)} className="text-red-500 text-xs underline">Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowBuilder(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={selectedExercises.length === 0} className="btn-primary">Create Program</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
      ) : programs.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No programs yet. Create one to assign exercises to a patient.</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Patient</th>
                <th className="text-left px-4 py-3">Program</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Created</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {programs.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{p.patient_last_name}, {p.patient_first_name}</td>
                  <td className="px-4 py-3">{p.name}</td>
                  <td className="px-4 py-3"><span className={'text-xs px-2 py-0.5 rounded-full ' + statusColor(p.status)}>{p.status}</span></td>
                  <td className="px-4 py-3 text-slate-500">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {p.status === 'active' && <button onClick={() => updateProgramStatus(p.id, 'archived')} className="text-xs text-yellow-600 underline">Archive</button>}
                      {p.status === 'archived' && <button onClick={() => updateProgramStatus(p.id, 'active')} className="text-xs text-green-600 underline">Reactivate</button>}
                      {p.status !== 'completed' && <button onClick={() => updateProgramStatus(p.id, 'completed')} className="text-xs text-blue-600 underline">Complete</button>}
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
