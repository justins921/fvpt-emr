import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface Task {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  assigned_to_first_name: string;
  assigned_to_last_name: string;
  assigned_by: string;
  assigned_by_first_name: string;
  assigned_by_last_name: string;
  priority: string;
  status: string;
  due_date: string | null;
  patient_id: string | null;
  patient_first_name: string | null;
  patient_last_name: string | null;
  patient_mrn: string | null;
  category: string | null;
  completed_at: string | null;
  created_at: string;
}

interface TaskSummary {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  overdue: number;
}

interface StaffUser {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  normal: 'bg-blue-100 text-blue-800',
  low: 'bg-slate-100 text-slate-600',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'badge-yellow',
  in_progress: 'badge-blue',
  completed: 'badge-green',
  cancelled: 'badge-gray',
};

const CATEGORIES = [
  { value: 'clinical', label: 'Clinical' },
  { value: 'billing', label: 'Billing' },
  { value: 'admin', label: 'Admin' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'other', label: 'Other' },
];

export default function TasksPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // View toggle
  const [viewMode, setViewMode] = useState<'my' | 'all'>('my');

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [page, setPage] = useState(1);

  // Staff list for assignment
  const [staff, setStaff] = useState<StaffUser[]>([]);

  // Create form
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { loadStaff(); loadSummary(); }, []);
  useEffect(() => { loadTasks(); }, [viewMode, statusFilter, priorityFilter, categoryFilter, assignedFilter, page]);

  async function loadSummary() {
    try {
      const res = await api.get<any>('/tasks/summary');
      setSummary(res.data);
    } catch {}
  }

  async function loadStaff() {
    try {
      const res = await api.get<any>('/users');
      setStaff((res.data || []).filter((u: any) => u.is_active));
    } catch {}
  }

  async function loadTasks() {
    setLoading(true);
    try {
      if (viewMode === 'my') {
        const params = new URLSearchParams();
        if (statusFilter) params.set('status', statusFilter);
        if (priorityFilter) params.set('priority', priorityFilter);
        const res = await api.get<any>(`/tasks/my?${params}`);
        setTasks(res.data || []);
        setTotal(res.data?.length || 0);
      } else {
        const params = new URLSearchParams({ page: String(page), limit: '25' });
        if (statusFilter) params.set('status', statusFilter);
        if (priorityFilter) params.set('priority', priorityFilter);
        if (categoryFilter) params.set('category', categoryFilter);
        if (assignedFilter) params.set('assigned_to', assignedFilter);
        const res = await api.get<any>(`/tasks?${params}`);
        setTasks(res.data || []);
        setTotal(res.meta?.total || 0);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load tasks');
    } finally { setLoading(false); }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    const dueDate = fd.get('dueDate') as string;
    try {
      await api.post('/tasks', {
        title: fd.get('title'),
        description: fd.get('description') || null,
        assignedTo: fd.get('assignedTo'),
        priority: fd.get('priority'),
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        patientId: fd.get('patientId') || null,
        category: fd.get('category') || null,
      });
      setShowForm(false);
      setSuccess('Task created');
      setTimeout(() => setSuccess(''), 4000);
      loadTasks();
      loadSummary();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create task');
    }
  }

  async function handleComplete(id: string) {
    try {
      await api.put(`/tasks/${id}/complete`);
      setSuccess('Task completed');
      setTimeout(() => setSuccess(''), 4000);
      loadTasks();
      loadSummary();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to complete task');
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancel this task?')) return;
    try {
      await api.delete(`/tasks/${id}`);
      setSuccess('Task cancelled');
      setTimeout(() => setSuccess(''), 4000);
      loadTasks();
      loadSummary();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel task');
    }
  }

  function isOverdue(task: Task): boolean {
    return !!task.due_date
      && new Date(task.due_date) < new Date()
      && task.status !== 'completed'
      && task.status !== 'cancelled';
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900 flex-1">Tasks</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">+ New Task</button>
      </div>

      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}<button onClick={() => setError('')} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card py-3 text-center">
            <div className="text-2xl font-bold text-yellow-600">{summary.byStatus.pending || 0}</div>
            <div className="text-xs text-slate-500">Pending</div>
          </div>
          <div className="card py-3 text-center">
            <div className="text-2xl font-bold text-blue-600">{summary.byStatus.in_progress || 0}</div>
            <div className="text-xs text-slate-500">In Progress</div>
          </div>
          <div className="card py-3 text-center">
            <div className="text-2xl font-bold text-red-600">{summary.overdue}</div>
            <div className="text-xs text-slate-500">Overdue</div>
          </div>
          <div className="card py-3 text-center">
            <div className="text-2xl font-bold text-green-600">{summary.byStatus.completed || 0}</div>
            <div className="text-xs text-slate-500">Completed</div>
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-3">
          <h3 className="font-semibold">New Task</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label">Title *</label>
              <input name="title" required maxLength={500} className="input" placeholder="Task title" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label">Description</label>
              <textarea name="description" rows={2} maxLength={5000} className="input" placeholder="Optional details" />
            </div>
            <div>
              <label className="label">Assign To *</label>
              <select name="assignedTo" required className="input">
                <option value="">Select...</option>
                {staff.map(s => (
                  <option key={s.id} value={s.id}>{s.last_name}, {s.first_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Priority *</label>
              <select name="priority" required className="input" defaultValue="normal">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="label">Due Date</label>
              <input name="dueDate" type="date" className="input" />
            </div>
            <div>
              <label className="label">Category</label>
              <select name="category" className="input">
                <option value="">None</option>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Patient ID</label>
              <input name="patientId" className="input" placeholder="Optional patient UUID" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create Task</button>
          </div>
        </form>
      )}

      {/* View toggle and filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex border rounded-lg overflow-hidden">
          <button
            onClick={() => { setViewMode('my'); setPage(1); }}
            className={`px-4 py-1.5 text-sm font-medium ${viewMode === 'my' ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >My Tasks</button>
          <button
            onClick={() => { setViewMode('all'); setPage(1); }}
            className={`px-4 py-1.5 text-sm font-medium ${viewMode === 'all' ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >All Tasks</button>
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="input max-w-[160px]">
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1); }} className="input max-w-[160px]">
          <option value="">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        {viewMode === 'all' && (
          <>
            <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }} className="input max-w-[160px]">
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select value={assignedFilter} onChange={e => { setAssignedFilter(e.target.value); setPage(1); }} className="input max-w-[200px]">
              <option value="">All Staff</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.last_name}, {s.first_name}</option>)}
            </select>
          </>
        )}
      </div>

      {/* Task list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : tasks.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No tasks found</div>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => (
            <div key={task.id} className={`card flex flex-col sm:flex-row sm:items-center gap-3 ${isOverdue(task) ? 'border-red-300 bg-red-50/30' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-slate-900">{task.title}</span>
                  <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${PRIORITY_COLORS[task.priority]}`}>
                    {task.priority}
                  </span>
                  <span className={STATUS_COLORS[task.status] || 'badge-gray'}>{task.status.replace('_', ' ')}</span>
                  {task.category && (
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{task.category.replace('_', ' ')}</span>
                  )}
                  {isOverdue(task) && (
                    <span className="text-xs text-red-600 font-medium">OVERDUE</span>
                  )}
                </div>
                {task.description && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-1">{task.description}</p>
                )}
                <div className="flex gap-4 mt-1 text-xs text-slate-400">
                  <span>Assigned to: {task.assigned_to_first_name} {task.assigned_to_last_name}</span>
                  {task.due_date && <span>Due: {new Date(task.due_date).toLocaleDateString()}</span>}
                  {task.patient_first_name && (
                    <span>Patient: {task.patient_last_name}, {task.patient_first_name}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {task.status !== 'completed' && task.status !== 'cancelled' && (
                  <>
                    <button onClick={() => handleComplete(task.id)} className="btn-primary text-xs px-3 py-1">Complete</button>
                    <button onClick={() => handleCancel(task.id)} className="btn-secondary text-xs px-3 py-1">Cancel</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {viewMode === 'all' && total > 25 && (
            <div className="flex items-center justify-between pt-2">
              <div className="text-sm text-slate-500">{total} total</div>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-secondary text-sm">Previous</button>
                <button disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)} className="btn-secondary text-sm">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
