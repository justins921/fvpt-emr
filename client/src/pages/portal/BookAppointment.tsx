import { useState, useEffect } from 'react';
import { portalApi } from './portalApi';

interface Therapist {
  id: string;
  first_name: string;
  last_name: string;
  credential: string | null;
}

interface Slot {
  start: string;
  therapists: Therapist[];
  first_available: boolean;
}

interface BookingResult {
  id: string;
  start_time: string;
  end_time: string;
  therapist: { id: string; name: string };
}

const APPT_TYPES = [
  { value: 'evaluation', label: 'Evaluation (first visit)' },
  { value: 'follow_up', label: 'Follow-up visit' },
  { value: 're_evaluation', label: 'Re-evaluation' },
  { value: 'discharge', label: 'Discharge visit' },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function BookAppointment() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [bookingMode, setBookingMode] = useState<string>('both');
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [error, setError] = useState('');

  const [dates, setDates] = useState<Date[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTherapist, setSelectedTherapist] = useState<string>('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const [confirmSlot, setConfirmSlot] = useState<Slot | null>(null);
  const [apptType, setApptType] = useState('follow_up');
  const [notes, setNotes] = useState('');
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState<BookingResult | null>(null);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    setLoading(true);
    setError('');
    try {
      const res: any = await portalApi('/portal/booking/therapists');
      const data = res.data || res;
      setTherapists(data.therapists || []);
      setBookingMode(data.booking_mode || 'both');
      setEnabled(true);
      // Build the next 14 date buttons (actual advance window enforced server-side)
      const ds: Date[] = [];
      const today = new Date();
      for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        ds.push(d);
      }
      setDates(ds);
      setSelectedDate(toYMD(ds[0]));
    } catch (err: any) {
      if (/403|not enabled/i.test(err.message)) {
        setEnabled(false);
      } else {
        setError(err.message || 'Could not load booking.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (enabled && selectedDate) loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedTherapist, enabled]);

  async function loadSlots() {
    setSlotsLoading(true);
    try {
      const params = new URLSearchParams({ date: selectedDate });
      if (selectedTherapist) params.set('therapist_id', selectedTherapist);
      const res: any = await portalApi(`/portal/booking/slots?${params.toString()}`);
      const data = res.data || res;
      setSlots(data.slots || []);
    } catch (err: any) {
      setError(err.message || 'Could not load time slots.');
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }

  async function submitBooking() {
    if (!confirmSlot) return;
    setBooking(true);
    setError('');
    try {
      const body: any = {
        slot_start: confirmSlot.start,
        appointment_type: apptType,
        notes: notes.trim() || null,
      };
      if (selectedTherapist && bookingMode !== 'first_available') {
        body.therapist_id = selectedTherapist;
      }
      const res: any = await portalApi('/portal/booking/book', {
        method: 'POST',
        body,
      });
      setResult((res.data || res) as BookingResult);
      setConfirmSlot(null);
    } catch (err: any) {
      setError(err.message || 'Booking failed. Please try another time.');
    } finally {
      setBooking(false);
    }
  }

  const canPickTherapist = bookingMode === 'specific_therapist' || bookingMode === 'both';

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="card text-center py-10">
        <p className="text-slate-600 font-medium">Online booking is not available</p>
        <p className="text-sm text-slate-400 mt-1">Please call the clinic to schedule your appointment.</p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="card text-center py-10 space-y-3">
        <div className="text-4xl" aria-hidden="true">✓</div>
        <h2 className="text-xl font-bold text-slate-900">You're booked</h2>
        <p className="text-slate-600">
          {fmtDate(result.start_time)} at {fmtTime(result.start_time)}
        </p>
        <p className="text-slate-600">with {result.therapist.name}</p>
        <button
          onClick={() => {
            setResult(null);
            setNotes('');
            loadSlots();
          }}
          className="btn-secondary min-h-[48px] mt-2"
        >
          Book another appointment
        </button>
      </div>
    );
  }

  if (confirmSlot) {
    return (
      <div className="card space-y-4">
        <h2 className="text-lg font-bold text-slate-900">Confirm your appointment</h2>
        <div className="bg-slate-50 rounded-lg p-3 text-sm">
          <div className="font-semibold text-slate-900">
            {fmtDate(confirmSlot.start)} at {fmtTime(confirmSlot.start)}
          </div>
          {confirmSlot.first_available || (!selectedTherapist && confirmSlot.therapists.length > 1) ? (
            <div className="text-slate-500 mt-1">
              Therapist assigned at booking (first available)
            </div>
          ) : (
            confirmSlot.therapists.length > 0 && (
              <div className="text-slate-500 mt-1">
                with {confirmSlot.therapists[0].first_name} {confirmSlot.therapists[0].last_name}
                {confirmSlot.therapists[0].credential ? `, ${confirmSlot.therapists[0].credential}` : ''}
              </div>
            )
          )}
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2" role="alert">
            {error}
          </div>
        )}
        <div>
          <label className="label" htmlFor="bk-type">Visit type</label>
          <select id="bk-type" className="input" value={apptType} onChange={(e) => setApptType(e.target.value)}>
            {APPT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="bk-notes">Notes for the clinic (optional)</label>
          <textarea
            id="bk-notes"
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything they should know before your visit…"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={() => setConfirmSlot(null)} className="btn-secondary flex-1 min-h-[48px]">
            Back
          </button>
          <button onClick={submitBooking} disabled={booking} className="btn-primary flex-1 min-h-[48px]">
            {booking ? 'Booking…' : 'Confirm booking'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900">Book an appointment</h2>

      {canPickTherapist && therapists.length > 0 && (
        <div>
          <label className="label" htmlFor="bk-therapist">Therapist</label>
          <select
            id="bk-therapist"
            className="input"
            value={selectedTherapist}
            onChange={(e) => setSelectedTherapist(e.target.value)}
          >
            {bookingMode === 'both' && <option value="">First available</option>}
            {therapists.map((t) => (
              <option key={t.id} value={t.id}>
                {t.first_name} {t.last_name}{t.credential ? `, ${t.credential}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <span className="label">Pick a day</span>
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {dates.map((d) => {
            const ymd = toYMD(d);
            const active = ymd === selectedDate;
            return (
              <button
                key={ymd}
                onClick={() => setSelectedDate(ymd)}
                className={`shrink-0 rounded-lg border px-3 py-2 text-center min-w-[64px] min-h-[56px] ${
                  active ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-slate-200 bg-white text-slate-700'
                }`}
              >
                <div className="text-xs font-medium">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div className="text-base font-bold">{d.getDate()}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="label">Available times</span>
        {slotsLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : slots.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-slate-500 text-sm">No open times this day. Try another date.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {slots.map((s) => (
              <button
                key={s.start}
                onClick={() => setConfirmSlot(s)}
                className="rounded-lg border border-slate-200 bg-white py-3 text-center min-h-[56px] hover:border-primary-500 hover:bg-primary-50 transition-colors"
              >
                <div className="font-semibold text-slate-900">{fmtTime(s.start)}</div>
                {!s.first_available && s.therapists.length > 1 && (
                  <div className="text-xs text-slate-400">{s.therapists.length} therapists</div>
                )}
                {s.first_available && <div className="text-xs text-slate-400">Any therapist</div>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
