import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface Exercise {
  id: string;
  name: string;
  description: string;
  body_region: string;
  category: string;
  difficulty: string;
  instructions: string;
  default_sets: number;
  default_reps: number;
  default_hold_seconds: number;
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
  const { user } = useAuth();
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
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === key ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
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

  useEffect(() => { loadExercises(); }, [search, regionFilter, categoryFilter]);

  async function loadExercises() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (regionFilter) params.set('body_region', regionFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      params.set('limit', '100');
      const qs = params.toString() ? `?${params}` : '';
      const res = await api.get<any>(`/exercises${qs}`);
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
    };
    try {
      if (editing) {
        await api.put(`/exercises/${editing.id}`, payload);
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
      await api.delete(`/exercises/${id}`);
      loadExercises();
    } catch {}
  }

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
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-sm">{ex.name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full ${difficultyColor(ex.difficulty)}`}>{ex.difficulty}</span>
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <div>Region: <span className="text-slate-700">{regionLabel(ex.body_region)}</span></div>
                <div>Category: <span className="text-slate-700">{categoryLabel(ex.category)}</span></div>
                <div>{ex.default_sets || 3}x{ex.default_reps || 10}{(ex.default_hold_seconds || 0) > 0 ? `, ${ex.default_hold_seconds}s hold` : ''}</div>
              </div>
              {ex.description && <p className="text-xs text-slate-600 mt-2 line-clamp-2">{ex.description}</p>}
              {ex.instructions && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{ex.instructions}</p>}
              <div className="flex gap-2 mt-3">
                <button onClick={() => { setEditing(ex); setShowForm(true); }} className="text-xs text-primary-600 underline">Edit</button>
                <button onClick={() => handleDelete(ex.id)} className="text-xs text-red-500 underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgramList() {
  const { user } = useAuth();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedExercises, setSelectedExercises] = useState<ProgramExercise[]>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryExercises, setLibraryExercises] = useState<Exercise[]>([]);

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
      alert(err instanceof ApiError ? err.message : 'Failed to create program');
    }
  }

  async function updateProgramStatus(id: string, status: string) {
    try {
      await api.put(`/exercises/programs/${id}`, { status });
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
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(p.status)}`}>{p.status}</span></td>
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
