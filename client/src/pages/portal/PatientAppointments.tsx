import { useState, useEffect } from 'react';
import { portalApi } from './portalApi';

interface Appointment {
  id: string;
  start_time: string;
  end_time: string;
  appointment_type: string;
  status: string;
  notes: string | null;
  therapist_first_name: string;
  therapist_last_name: string;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function typeLabel(t: string): string {
  const map: Record<string, string> = {
    evaluation: 'Evaluation',
    follow_up: 'Follow-up',
    re_evaluation: 'Re-evaluation',
    discharge: 'Discharge',
  };
  return map[t] || t;
}

export default function PatientAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await portalApi<Appointment[]>('/portal/patient/appointments/upcoming');
      setAppointments(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Could not load your appointments.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2" role="alert">
        {error}
      </div>
    );
  }

  if (appointments.length === 0) {
    return (
      <div className="card text-center py-10">
        <p className="text-slate-600 font-medium">No upcoming appointments</p>
        <p className="text-sm text-slate-400 mt-1">
          Use the Book Appointment tab to schedule your next visit.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {appointments.map((a) => (
        <div key={a.id} className="card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900">
                {fmtDate(a.start_time)} at {fmtTime(a.start_time)}
              </p>
              <p className="text-sm text-slate-500 mt-0.5">
                {typeLabel(a.appointment_type)} with {a.therapist_first_name} {a.therapist_last_name}
              </p>
              {a.notes && <p className="text-sm text-slate-400 mt-1">{a.notes}</p>}
            </div>
            {a.status === 'checked_in' && (
              <span className="text-xs font-medium bg-blue-50 text-blue-700 rounded-full px-2.5 py-1 whitespace-nowrap">
                Checked in
              </span>
            )}
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-400 text-center pt-2">
        Need to change an appointment? Contact your clinic directly.
      </p>
    </div>
  );
}
