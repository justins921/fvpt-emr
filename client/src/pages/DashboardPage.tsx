import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useDashboardPrefs } from '../hooks/useDashboardPrefs';
import {
  CardId,
  CardPref,
  DashboardPrefs,
  CARD_LABELS,
  ACCENT_PRESETS,
  accentPreset,
  processAvatar,
} from '../utils/dashboardPrefs';

function sortedCards(cards: CardPref[]): CardPref[] {
  return [...cards].sort((a, b) => a.order - b.order);
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { prefs, save: savePrefs } = useDashboardPrefs();
  const location = useLocation();
  const [stats, setStats] = useState({ patients: 0, todayAppts: 0, pendingClaims: 0 });
  const [todayAppointments, setTodayAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState<DashboardPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  // Open customize mode when navigated here with { state: { customize: true } }
  useEffect(() => {
    if ((location.state as any)?.customize) {
      startCustomize();
      // Clear the state so a refresh doesn't reopen it
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  async function loadDashboard() {
    try {
      const today = new Date().toISOString().substring(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().substring(0, 10);

      const [patientsRes, apptsRes, claimsRes] = await Promise.all([
        api.get<any>(`/patients?limit=1`),
        api.get<any>(`/scheduling?startDate=${today}T00:00:00Z&endDate=${tomorrow}T00:00:00Z`),
        api.get<any>('/billing/claims?status=draft&limit=1'),
      ]);

      setStats({
        patients: patientsRes.meta?.total || 0,
        todayAppts: apptsRes.data?.length || 0,
        pendingClaims: claimsRes.meta?.total || 0,
      });
      setTodayAppointments(apptsRes.data || []);
    } catch (err) {
      console.error('Dashboard load error');
    } finally {
      setLoading(false);
    }
  }

  function startCustomize() {
    setDraft({
      cards: sortedCards(prefs.cards),
      accent_color: prefs.accent_color,
      avatar: prefs.avatar,
    });
    setSaveError(null);
    setAvatarError(null);
    setSavedMsg(null);
    setCustomizing(true);
  }

  function cancelCustomize() {
    setCustomizing(false);
    setDraft(null);
    setSaveError(null);
    setAvatarError(null);
  }

  function toggleVisible(id: CardId) {
    setDraft((prev) =>
      prev ? { ...prev, cards: prev.cards.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)) } : prev
    );
  }

  function move(id: CardId, dir: -1 | 1) {
    setDraft((prev) => {
      if (!prev) return prev;
      const ordered = sortedCards(prev.cards);
      const idx = ordered.findIndex((c) => c.id === id);
      const next = idx + dir;
      if (next < 0 || next >= ordered.length) return prev;
      const swapped = [...ordered];
      [swapped[idx], swapped[next]] = [swapped[next], swapped[idx]];
      return { ...prev, cards: swapped.map((c, i) => ({ ...c, order: i })) };
    });
  }

  function setAccent(id: string) {
    setDraft((prev) => (prev ? { ...prev, accent_color: id } : prev));
  }

  async function handleAvatarFile(file: File | undefined) {
    if (!file) return;
    setAvatarError(null);
    try {
      const dataUrl = await processAvatar(file);
      setDraft((prev) => (prev ? { ...prev, avatar: dataUrl } : prev));
    } catch (err: any) {
      setAvatarError(err?.message || 'Could not process that image.');
    }
  }

  function removeAvatar() {
    setDraft((prev) => (prev ? { ...prev, avatar: null } : prev));
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      await savePrefs({
        cards: sortedCards(draft.cards).map((c, i) => ({ ...c, order: i })),
        accent_color: draft.accent_color,
        avatar: draft.avatar,
      });
      setCustomizing(false);
      setDraft(null);
      setSavedMsg('Dashboard preferences saved.');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (err: any) {
      setSaveError(err?.message || 'Could not save dashboard preferences.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  const visibleCards = sortedCards(prefs.cards).filter((c) => c.visible);

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

      {customizing && draft && (
        <div className="card border-primary-200 space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-1">Customize dashboard</h2>
            <p className="text-sm text-slate-500">Sections, sidebar color, and your profile picture.</p>
          </div>
          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-2">
              {saveError}
            </div>
          )}

          {/* Sections */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Sections</h3>
            <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
              {sortedCards(draft.cards).map((c, idx, arr) => (
                <div key={c.id} className="py-2.5 px-3 flex items-center gap-3">
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
          </div>

          {/* Sidebar color */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Sidebar color</h3>
            <div className="flex gap-3">
              {ACCENT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setAccent(p.id)}
                  className={`w-10 h-10 rounded-full border-2 transition-all ${
                    draft.accent_color === p.id
                      ? 'border-slate-900 ring-2 ring-offset-2 ring-slate-400'
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: p.shades['800'] }}
                  title={p.name}
                  aria-label={`Sidebar color: ${p.name}`}
                  aria-pressed={draft.accent_color === p.id}
                />
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {accentPreset(draft.accent_color).name} — applies to the sidebar right away after saving.
            </p>
          </div>

          {/* Profile picture */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Profile picture</h3>
            <div className="flex items-center gap-4">
              {draft.avatar ? (
                <img src={draft.avatar} alt="Profile preview" className="w-14 h-14 rounded-full object-cover" />
              ) : (
                <div className="w-14 h-14 bg-slate-200 rounded-full flex items-center justify-center text-lg font-medium text-slate-600">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </div>
              )}
              <div className="space-y-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleAvatarFile(e.target.files?.[0])}
                />
                <div className="flex gap-2">
                  <button onClick={() => fileRef.current?.click()} className="btn-secondary text-sm">
                    Upload photo
                  </button>
                  {draft.avatar && (
                    <button onClick={removeAvatar} className="btn-ghost text-sm">
                      Remove
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500">JPG or PNG. Resized to 256px automatically.</p>
              </div>
            </div>
            {avatarError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-2 mt-2">
                {avatarError}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
              {saving ? 'Saving…' : 'Save preferences'}
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
