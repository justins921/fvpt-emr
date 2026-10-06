import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../hooks/useAuth';

type CardId = 'stats' | 'schedule' | 'quick_actions';

interface CardPref {
  id: CardId;
  visible: boolean;
  order: number;
}

const CARD_LABELS: Record<CardId, string> = {
  stats: 'Stats overview',
  schedule: "Today's schedule",
  quick_actions: 'Quick actions',
};

const DEFAULT_CARDS: CardPref[] = [
  { id: 'stats', visible: true, order: 0 },
  { id: 'schedule', visible: true, order: 1 },
  { id: 'quick_actions', visible: true, order: 2 },
];

function unwrap(res: any) {
  if (!res) return {};
  return res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : res;
}

function sortedCards(cards: CardPref[]): CardPref[] {
  return [...cards].sort((a, b) => a.order - b.order);
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ patients: 0, todayAppts: 0, pendingClaims: 0 });
  const [todayAppointments, setTodayAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<CardPref[]>(DEFAULT_CARDS);
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState<CardPref[]>(DEFAULT_CARDS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      const today = new Date().toISOString().substring(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().substring(0, 10);

      const [patientsRes, apptsRes, claimsRes, prefsRes] = await Promise.all([
        api.get<any>(`/patients?limit=1`),
        api.get<any>(`/scheduling?startDate=${today}T00:00:00Z&endDate=${tomorrow}T00:00:00Z`),
        api.get<any>('/billing/claims?status=draft&limit=1'),
        api.get<any>('/users/me/dashboard').catch(() => null),
      ]);

      setStats({
        patients: patientsRes.meta?.total || 0,
        todayAppts: apptsRes.data?.length || 0,
        pendingClaims: claimsRes.meta?.total || 0,
      });
      setTodayAppointments(apptsRes.data || []);

      const prefs = unwrap(prefsRes);
      if (prefs && Array.isArray(prefs.cards) && prefs.cards.length > 0) {
        const merged = prefs.cards
          .filter((c: any) => c.id in CARD_LABELS)
          .map((c: any) => ({
            id: c.id as CardId,
            visible: c.visible !== false,
            order: Number.isInteger(c.order) ? c.order : 0,
          }));
        if (merged.length > 0) setCards(sortedCards(merged));
      }
    } catch (err) {
      console.error('Dashboard load error');
    } finally {
      setLoading(false);
    }
  }

  function startCustomize() {
    setDraft(sortedCards(cards));
    setSaveError(null);
    setSavedMsg(null);
    setCustomizing(true);
  }

  function cancelCustomize() {
    setCustomizing(false);
    setSaveError(null);
  }

  function toggleVisible(id: CardId) {
    setDraft((prev) => prev.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)));
  }

  function move(id: CardId, dir: -1 | 1) {
    setDraft((prev) => {
      const ordered = sortedCards(prev);
      const idx = ordered.findIndex((c) => c.id === id);
      const next = idx + dir;
      if (next < 0 || next >= ordered.length) return prev;
      const swapped = [...ordered];
      [swapped[idx], swapped[next]] = [swapped[next], swapped[idx]];
      return swapped.map((c, i) => ({ ...c, order: i }));
    });
  }

  async function savePrefs() {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = { cards: sortedCards(draft).map((c, i) => ({ ...c, order: i })) };
      const res = await api.put<any>('/users/me/dashboard', payload);
      const saved = unwrap(res);
      if (saved && Array.isArray(saved.cards)) {
        setCards(sortedCards(saved.cards));
      } else {
        setCards(payload.cards);
      }
      setCustomizing(false);
      setSavedMsg('Dashboard layout saved.');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (err: any) {
      setSaveError(err?.message || 'Could not save dashboard layout.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  const visibleCards = sortedCards(cards).filter((c) => c.visible);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {user?.firstName}
          </h1>
          <p className="text-slate-500 mt-1">Here's your overview for today</p>
        </div>
        {!customizing && (
          <button onClick={startCustomize} className="btn-secondary text-sm">
            Customize
          </button>
        )}
      </div>

      {savedMsg && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded px-4 py-2">
          {savedMsg}
        </div>
      )}

      {customizing && (
        <div className="card border-primary-200">
          <h2 className="text-lg font-semibold mb-1">Customize dashboard</h2>
          <p className="text-sm text-slate-500 mb-4">Choose which sections show, and reorder them with the arrows.</p>
          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-2 mb-4">
              {saveError}
            </div>
          )}
          <div className="divide-y divide-slate-100">
            {sortedCards(draft).map((c, idx, arr) => (
              <div key={c.id} className="py-3 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={c.visible}
                  onChange={() => toggleVisible(c.id)}
                  className="h-4 w-4 accent-primary-600"
                  aria-label={`Show ${CARD_LABELS[c.id]}`}
                />
                <span className={`flex-1 text-sm font-medium ${c.visible ? 'text-slate-900' : 'text-slate-400'}`}>
                  {CARD_LABELS[c.id]}
                </span>
                <button
                  onClick={() => move(c.id, -1)}
                  disabled={idx === 0}
                  className="btn-secondary text-sm px-2 py-1 disabled:opacity-30"
                  aria-label={`Move ${CARD_LABELS[c.id]} up`}
                >
                  ↑
                </button>
                <button
                  onClick={() => move(c.id, 1)}
                  disabled={idx === arr.length - 1}
                  className="btn-secondary text-sm px-2 py-1 disabled:opacity-30"
                  aria-label={`Move ${CARD_LABELS[c.id]} down`}
                >
                  ↓
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={savePrefs} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
              {saving ? 'Saving…' : 'Save layout'}
            </button>
            <button onClick={cancelCustomize} disabled={saving} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {visibleCards.map((c) => {
        if (c.id === 'stats') return <StatsSection key="stats" stats={stats} />;
        if (c.id === 'schedule') return <ScheduleSection key="schedule" appointments={todayAppointments} />;
        return <QuickActionsSection key="quick_actions" />;
      })}
    </div>
  );
}

function StatsSection({ stats }: { stats: { patients: number; todayAppts: number; pendingClaims: number } }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Link to="/app/patients" className="card hover:shadow-md transition-shadow">
        <div className="text-sm text-slate-500">Total Patients</div>
        <div className="text-3xl font-bold text-slate-900 mt-1">{stats.patients}</div>
      </Link>
      <Link to="/app/schedule" className="card hover:shadow-md transition-shadow">
        <div className="text-sm text-slate-500">Today's Appointments</div>
        <div className="text-3xl font-bold text-primary-600 mt-1">{stats.todayAppts}</div>
      </Link>
      <Link to="/app/billing" className="card hover:shadow-md transition-shadow">
        <div className="text-sm text-slate-500">Draft Claims</div>
        <div className="text-3xl font-bold text-yellow-600 mt-1">{stats.pendingClaims}</div>
      </Link>
    </div>
  );
}

function ScheduleSection({ appointments }: { appointments: any[] }) {
  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">Today's Schedule</h2>
      {appointments.length === 0 ? (
        <p className="text-slate-500 text-sm py-4 text-center">No appointments scheduled for today</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {appointments.map((appt: any) => (
            <div key={appt.id} className="py-3 flex items-center gap-4">
              <div className="text-sm font-medium text-slate-900 w-20">
                {new Date(appt.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </div>
              <div className="flex-1">
                <Link to={`/app/patients/${appt.patient_id}`} className="text-sm font-medium text-primary-600 hover:underline">
                  {appt.patient_last_name}, {appt.patient_first_name}
                </Link>
                <div className="text-xs text-slate-500 capitalize">{appt.appointment_type.replace('_', ' ')}</div>
              </div>
              <span className={`badge ${
                appt.status === 'completed' ? 'badge-green' :
                appt.status === 'checked_in' ? 'badge-blue' :
                appt.status === 'cancelled' ? 'badge-red' : 'badge-gray'
              }`}>
                {appt.status.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickActionsSection() {
  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link to="/app/patients?new=1" className="btn-secondary text-center text-sm">New Patient</Link>
        <Link to="/app/schedule" className="btn-secondary text-center text-sm">Schedule Appt</Link>
        <Link to="/app/billing" className="btn-secondary text-center text-sm">View Claims</Link>
        <Link to="/app/admin" className="btn-secondary text-center text-sm">Admin Panel</Link>
      </div>
    </div>
  );
}
