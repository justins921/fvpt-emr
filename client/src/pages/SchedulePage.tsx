import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../services/api';
import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval, isToday, isSameDay } from 'date-fns';

interface Appointment {
  id: string; patient_id: string; therapist_id: string;
  start_time: string; end_time: string;
  appointment_type: string; status: string; notes: string;
  patient_first_name: string; patient_last_name: string; mrn: string;
  therapist_first_name: string; therapist_last_name: string;
}

export default function SchedulePage() {
  const [view, setView] = useState<'day' | 'week'>('day');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [patients, setPatients] = useState<any[]>([]);
  const [therapists, setTherapists] = useState<any[]>([]);

  useEffect(() => { loadData(); }, [currentDate, view]);

  async function loadData() {
    setLoading(true);
    try {
      let start: Date, end: Date;
      if (view === 'week') {
        start = startOfWeek(currentDate, { weekStartsOn: 1 });
        end = endOfWeek(currentDate, { weekStartsOn: 1 });
      } else {
        start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);
        end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
      }

      const [apptRes, patRes, userRes] = await Promise.all([
        api.get<any>(`/scheduling?startDate=${start.toISOString()}&endDate=${end.toISOString()}`),
        api.get<any>('/patients?limit=100'),
        api.get<any>('/users'),
      ]);

      setAppointments(apptRes.data || []);
      setPatients(patRes.data || []);
      setTherapists((userRes.data || []).filter((u: any) => u.role === 'therapist' || u.role === 'owner' || u.role === 'admin'));
    } catch {} finally { setLoading(false); }
  }

  async function handleCreateAppointment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const date = fd.get('date') as string;
    const startTime = fd.get('startTime') as string;
    const endTime = fd.get('endTime') as string;
    try {
      await api.post('/scheduling', {
        patientId: fd.get('patientId'),
        therapistId: fd.get('therapistId'),
        startTime: `${date}T${startTime}:00.000Z`,
        endTime: `${date}T${endTime}:00.000Z`,
        appointmentType: fd.get('appointmentType'),
        notes: fd.get('notes') || null,
      });
      setShowNewForm(false);
      loadData();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to create appointment');
    }
  }

  async function updateStatus(id: string, status: string) {
    try {
      await api.patch(`/scheduling/${id}/status`, { status });
      loadData();
    } catch {}
  }

  const weekDays = view === 'week'
    ? eachDayOfInterval({ start: startOfWeek(currentDate, { weekStartsOn: 1 }), end: endOfWeek(currentDate, { weekStartsOn: 1 }) })
    : [currentDate];

  const hours = Array.from({ length: 12 }, (_, i) => i + 7); // 7 AM to 6 PM

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <h1 className="text-2xl font-bold flex-1">Schedule</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentDate(d => addDays(d, view === 'week' ? -7 : -1))} className="btn-ghost">←</button>
          <button onClick={() => setCurrentDate(new Date())} className="btn-ghost text-sm">Today</button>
          <button onClick={() => setCurrentDate(d => addDays(d, view === 'week' ? 7 : 1))} className="btn-ghost">→</button>
          <span className="text-sm font-medium mx-2">{format(currentDate, 'MMMM d, yyyy')}</span>
          <div className="flex border rounded-lg overflow-hidden">
            <button onClick={() => setView('day')} className={`px-3 py-1.5 text-sm ${view === 'day' ? 'bg-primary-600 text-white' : 'bg-white'}`}>Day</button>
            <button onClick={() => setView('week')} className={`px-3 py-1.5 text-sm ${view === 'week' ? 'bg-primary-600 text-white' : 'bg-white'}`}>Week</button>
          </div>
          <button onClick={() => setShowNewForm(!showNewForm)} className="btn-primary text-sm">+ New</button>
        </div>
      </div>

      {showNewForm && (
        <form onSubmit={handleCreateAppointment} className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="label">Patient *</label>
            <select name="patientId" required className="input">
              <option value="">Select patient...</option>
              {patients.map((p: any) => <option key={p.id} value={p.id}>{p.last_name}, {p.first_name} ({p.mrn})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Therapist *</label>
            <select name="therapistId" required className="input">
              <option value="">Select therapist...</option>
              {therapists.map((t: any) => <option key={t.id} value={t.id}>{t.last_name}, {t.first_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Type *</label>
            <select name="appointmentType" required className="input">
              <option value="follow_up">Follow Up</option>
              <option value="evaluation">Evaluation</option>
              <option value="re_evaluation">Re-evaluation</option>
              <option value="discharge">Discharge</option>
            </select>
          </div>
          <div><label className="label">Date *</label><input name="date" type="date" required className="input" defaultValue={format(currentDate, 'yyyy-MM-dd')} /></div>
          <div><label className="label">Start Time *</label><input name="startTime" type="time" required className="input" defaultValue="09:00" /></div>
          <div><label className="label">End Time *</label><input name="endTime" type="time" required className="input" defaultValue="09:45" /></div>
          <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowNewForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create Appointment</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <div className={`grid ${view === 'week' ? 'grid-cols-[60px_repeat(7,1fr)]' : 'grid-cols-[60px_1fr]'} min-w-[600px]`}>
            {/* Header */}
            <div className="border-b border-r bg-slate-50 p-2"></div>
            {weekDays.map(day => (
              <div key={day.toISOString()} className={`border-b p-2 text-center text-sm ${isToday(day) ? 'bg-primary-50 font-bold' : 'bg-slate-50'}`}>
                <div className="text-xs text-slate-500">{format(day, 'EEE')}</div>
                <div>{format(day, 'd')}</div>
              </div>
            ))}

            {/* Time slots */}
            {hours.map(hour => (
              <>
                <div key={`h-${hour}`} className="border-r border-b p-1 text-xs text-slate-400 text-right pr-2">
                  {hour > 12 ? hour - 12 : hour}{hour >= 12 ? 'p' : 'a'}
                </div>
                {weekDays.map(day => {
                  const dayAppts = appointments.filter(a => {
                    const apptDate = new Date(a.start_time);
                    return isSameDay(apptDate, day) && apptDate.getHours() === hour;
                  });
                  return (
                    <div key={`${day.toISOString()}-${hour}`} className="border-b border-r min-h-[60px] p-1 relative">
                      {dayAppts.map(appt => (
                        <div
                          key={appt.id}
                          className={`text-xs p-1.5 rounded mb-1 cursor-pointer ${
                            appt.status === 'completed' ? 'bg-green-100 border-green-300' :
                            appt.status === 'checked_in' ? 'bg-blue-100 border-blue-300' :
                            appt.status === 'cancelled' ? 'bg-red-100 border-red-300 line-through' :
                            appt.status === 'no_show' ? 'bg-yellow-100 border-yellow-300' :
                            'bg-primary-50 border-primary-200'
                          } border`}
                        >
                          <div className="font-medium">
                            <Link to={`/patients/${appt.patient_id}`} className="hover:underline">
                              {appt.patient_last_name}, {appt.patient_first_name}
                            </Link>
                          </div>
                          <div className="text-slate-500">
                            {format(new Date(appt.start_time), 'h:mm')}-{format(new Date(appt.end_time), 'h:mma')}
                          </div>
                          <div className="mt-1 flex gap-1 flex-wrap">
                            {appt.status === 'scheduled' && <button onClick={() => updateStatus(appt.id, 'checked_in')} className="text-blue-600 underline">Check In</button>}
                            {appt.status === 'checked_in' && <button onClick={() => updateStatus(appt.id, 'in_progress')} className="text-blue-600 underline">Start</button>}
                            {appt.status === 'in_progress' && <button onClick={() => updateStatus(appt.id, 'completed')} className="text-green-600 underline">Complete</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
