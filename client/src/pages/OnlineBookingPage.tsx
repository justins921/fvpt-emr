import { useState, useEffect } from 'react';
import { api } from '../services/api';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface BookingSettings {
  online_booking_enabled: boolean;
  booking_mode: 'specific_therapist' | 'first_available' | 'both';
  advance_booking_days: number;
  slot_duration_minutes: number;
  booking_window_start: string;
  booking_window_end: string;
}

interface HoursBlock {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

interface Therapist {
  id: string;
  first_name: string;
  last_name: string;
  credential: string | null;
  role: string;
  is_bookable_online: boolean;
  hours: HoursBlock[];
}

function unwrap(res: any): any {
  if (!res) return null;
  if (res.data !== undefined) return res.data;
  return res;
}

export default function OnlineBookingPage() {
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingTherapist, setSavingTherapist] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [s, t] = await Promise.all([
        api.get<any>('/online-booking/settings'),
        api.get<any>('/online-booking/therapists'),
      ]);
      setSettings(unwrap(s));
      setTherapists(unwrap(t) || []);
    } catch (err: any) {
      setError(err.message || 'Could not load online booking settings.');
    } finally {
      setLoading(false);
    }
  }

  function set<K extends keyof BookingSettings>(key: K, value: BookingSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      await api.put('/online-booking/settings', settings);
      setOkMsg('Booking settings saved.');
    } catch (err: any) {
      setError(err.message || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  function toggleBookable(id: string, value: boolean) {
    setTherapists((prev) => prev.map((t) => (t.id === id ? { ...t, is_bookable_online: value } : t)));
  }

  function addBlock(therapistId: string) {
    setTherapists((prev) =>
      prev.map((t) =>
        t.id === therapistId
          ? { ...t, hours: [...t.hours, { day_of_week: 1, start_time: '08:00', end_time: '17:00' }] }
          : t
      )
    );
  }

  function updateBlock(therapistId: string, idx: number, patch: Partial<HoursBlock>) {
    setTherapists((prev) =>
      prev.map((t) =>
        t.id === therapistId
          ? { ...t, hours: t.hours.map((h, i) => (i === idx ? { ...h, ...patch } : h)) }
          : t
      )
    );
  }

  function removeBlock(therapistId: string, idx: number) {
    setTherapists((prev) =>
      prev.map((t) =>
        t.id === therapistId ? { ...t, hours: t.hours.filter((_, i) => i !== idx) } : t
      )
    );
  }

  async function saveTherapist(t: Therapist) {
    setSavingTherapist(t.id);
    setError('');
    try {
      await api.put(`/online-booking/therapists/${t.id}`, {
        is_bookable_online: t.is_bookable_online,
        hours: t.hours,
      });
      setOkMsg(`${t.first_name} ${t.last_name} booking availability saved.`);
    } catch (err: any) {
      setError(err.message || 'Could not save therapist availability.');
    } finally {
      setSavingTherapist(null);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-slate-900">Online Booking</h1>
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900">Online Booking</h1>
      <p className="text-sm text-slate-500 mt-1">
        Let patients book their own appointments from the patient portal. Sports Clips style: they
        pick any open slot, and you decide whether they choose a therapist or get the first one free.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2 mt-4" role="alert">
          {error}
        </div>
      )}
      {okMsg && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded px-3 py-2 mt-4" role="status">
          {okMsg}
        </div>
      )}

      {/* ── Clinic settings ── */}
      <div className="card mt-6 space-y-4">
        <h2 className="font-semibold text-slate-900">Clinic settings</h2>

        <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
          <input
            type="checkbox"
            checked={settings?.online_booking_enabled || false}
            onChange={(e) => set('online_booking_enabled', e.target.checked)}
            className="h-5 w-5 rounded border-slate-300 text-primary-600"
          />
          <span className="font-medium text-slate-900">Enable online booking</span>
        </label>

        <div>
          <span className="label">Booking mode</span>
          <div className="space-y-2 mt-1">
            <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
              <input
                type="radio"
                name="booking_mode"
                checked={settings?.booking_mode === 'specific_therapist'}
                onChange={() => set('booking_mode', 'specific_therapist')}
                className="mt-1 h-4 w-4 text-primary-600"
              />
              <span>
                <span className="font-medium text-slate-900">Patient picks a therapist</span>
                <span className="block text-sm text-slate-500">They choose who they see when they book.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
              <input
                type="radio"
                name="booking_mode"
                checked={settings?.booking_mode === 'first_available'}
                onChange={() => set('booking_mode', 'first_available')}
                className="mt-1 h-4 w-4 text-primary-600"
              />
              <span>
                <span className="font-medium text-slate-900">First available therapist</span>
                <span className="block text-sm text-slate-500">
                  The patient books any open slot. The system assigns the therapist with the lightest
                  schedule that day.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
              <input
                type="radio"
                name="booking_mode"
                checked={settings?.booking_mode === 'both'}
                onChange={() => set('booking_mode', 'both')}
                className="mt-1 h-4 w-4 text-primary-600"
              />
              <span>
                <span className="font-medium text-slate-900">Let the patient choose</span>
                <span className="block text-sm text-slate-500">
                  They can pick a therapist or take the first available slot.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="label" htmlFor="ob-advance">Book up to (days)</label>
            <input
              id="ob-advance"
              type="number"
              min={1}
              max={90}
              className="input"
              value={settings?.advance_booking_days ?? 14}
              onChange={(e) => set('advance_booking_days', parseInt(e.target.value, 10) || 14)}
            />
          </div>
          <div>
            <label className="label" htmlFor="ob-slot">Slot length (min)</label>
            <select
              id="ob-slot"
              className="input"
              value={settings?.slot_duration_minutes ?? 30}
              onChange={(e) => set('slot_duration_minutes', parseInt(e.target.value, 10))}
            >
              <option value={15}>15</option>
              <option value={30}>30</option>
              <option value={45}>45</option>
              <option value={60}>60</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ob-start">Earliest</label>
            <input
              id="ob-start"
              type="time"
              className="input"
              value={settings?.booking_window_start ?? '08:00'}
              onChange={(e) => set('booking_window_start', e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="ob-end">Latest</label>
            <input
              id="ob-end"
              type="time"
              className="input"
              value={settings?.booking_window_end ?? '17:00'}
              onChange={(e) => set('booking_window_end', e.target.value)}
            />
          </div>
        </div>

        <button onClick={saveSettings} disabled={saving} className="btn-primary min-h-[48px]">
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {/* ── Therapist availability ── */}
      <div className="card mt-6">
        <h2 className="font-semibold text-slate-900">Therapist availability</h2>
        <p className="text-sm text-slate-500 mt-1 mb-4">
          Check who can be booked online, then set their weekly bookable hours. Only time inside
          these blocks shows up for patients.
        </p>
        <div className="space-y-2">
          {therapists.length === 0 && (
            <p className="text-sm text-slate-400">No therapists found.</p>
          )}
          {therapists.map((t) => (
            <div key={t.id} className="border border-slate-200 rounded-lg">
              <div className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={t.is_bookable_online}
                  onChange={(e) => toggleBookable(t.id, e.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-primary-600"
                  aria-label={`Allow online booking for ${t.first_name} ${t.last_name}`}
                />
                <button
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                  className="flex-1 text-left min-h-[44px]"
                >
                  <span className="font-medium text-slate-900">
                    {t.first_name} {t.last_name}
                    {t.credential ? `, ${t.credential}` : ''}
                  </span>
                  <span className="text-xs text-slate-400 ml-2">{t.role}</span>
                  <span className="block text-xs text-slate-500">
                    {t.hours.length === 0
                      ? 'No booking hours set'
                      : `${t.hours.length} time block${t.hours.length === 1 ? '' : 's'}`}
                  </span>
                </button>
                <button
                  onClick={() => saveTherapist(t)}
                  disabled={savingTherapist === t.id}
                  className="btn-secondary text-sm min-h-[44px]"
                >
                  {savingTherapist === t.id ? 'Saving…' : 'Save'}
                </button>
              </div>
              {expanded === t.id && (
                <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-2">
                  {t.hours.map((h, i) => (
                    <div key={i} className="flex items-center gap-2 flex-wrap">
                      <select
                        value={h.day_of_week}
                        onChange={(e) => updateBlock(t.id, i, { day_of_week: parseInt(e.target.value, 10) })}
                        className="input w-28"
                        aria-label="Day"
                      >
                        {DAYS.map((d, di) => (
                          <option key={di} value={di}>{d}</option>
                        ))}
                      </select>
                      <input
                        type="time"
                        value={h.start_time}
                        onChange={(e) => updateBlock(t.id, i, { start_time: e.target.value })}
                        className="input w-32"
                        aria-label="Start time"
                      />
                      <span className="text-slate-400">to</span>
                      <input
                        type="time"
                        value={h.end_time}
                        onChange={(e) => updateBlock(t.id, i, { end_time: e.target.value })}
                        className="input w-32"
                        aria-label="End time"
                      />
                      <button
                        onClick={() => removeBlock(t.id, i)}
                        className="text-sm text-red-600 underline min-h-[44px] px-2"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addBlock(t.id)}
                    className="text-sm text-primary-700 underline min-h-[44px]"
                  >
                    + Add time block
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
