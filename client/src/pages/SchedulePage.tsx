import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../services/api';
import { format, addDays, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isToday, isSameDay, isSameMonth } from 'date-fns';

interface Appointment {
  id: string; patient_id: string; therapist_id: string;
  location_id: string | null;
  start_time: string; end_time: string;
  appointment_type: string; status: string; notes: string;
  patient_first_name: string; patient_last_name: string; mrn: string;
  therapist_first_name: string; therapist_last_name: string;
  therapist_credential: string | null;
  location_name: string | null;
}

interface Provider {
  id: string;
  first_name: string;
  last_name: string;
  credential: string | null;
  role: string;
}

interface Location {
  id: string;
  name: string;
  is_primary: boolean;
  is_active: boolean;
}

/** Credentials that can have their own schedule column */
const SCHEDULING_CREDENTIALS = ['PT', 'DPT', 'ATC'];

function statusClasses(status: string) {
  switch (status) {
    case 'completed': return 'bg-green-100 border-green-300';
    case 'checked_in': return 'bg-blue-100 border-blue-300';
    case 'cancelled': return 'bg-red-100 border-red-300 line-through';
    case 'no_show': return 'bg-yellow-100 border-yellow-300';
    default: return 'bg-primary-50 border-primary-200';
  }
}

function monthStatusClasses(status: string) {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-800';
    case 'cancelled': return 'bg-red-100 text-red-800 line-through';
    case 'no_show': return 'bg-yellow-100 text-yellow-800';
    default: return 'bg-primary-100 text-primary-800';
  }
}

export default function SchedulePage() {
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [patients, setPatients] = useState<any[]>([]);
  const [allTherapists, setAllTherapists] = useState<Provider[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('all');
  const [mobileProviderId, setMobileProviderId] = useState<string>('all');

  // Scheduling providers = users with PT, DPT, or ATC credential
  const providers = useMemo(
    () => allTherapists.filter(t => SCHEDULING_CREDENTIALS.includes(t.credential || '')),
    [allTherapists]
  );

  // Set initial mobile provider once providers load
  useEffect(() => {
    if (providers.length > 0 && mobileProviderId === 'all') {
      // keep 'all' as default — user can pick one
    }
  }, [providers]);

  useEffect(() => { loadData(); }, [currentDate, view, selectedLocationId]);

  async function loadData() {
    setLoading(true);
    try {
      let start: Date, end: Date;
      if (view === 'month') {
        start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
        end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
      } else if (view === 'week') {
        start = startOfWeek(currentDate, { weekStartsOn: 1 });
        end = endOfWeek(currentDate, { weekStartsOn: 1 });
      } else {
        start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);
        end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
      }

      const locationParam = selectedLocationId !== 'all' ? `&locationId=${selectedLocationId}` : '';
      const [apptRes, patRes, userRes, locRes] = await Promise.all([
        api.get<any>(`/scheduling?startDate=${start.toISOString()}&endDate=${end.toISOString()}${locationParam}`),
        api.get<any>('/patients?limit=100'),
        api.get<any>('/users'),
        api.get<any>('/locations'),
      ]);

      setAppointments(apptRes.data || []);
      setPatients(patRes.data || []);
      setAllTherapists(
        (userRes.data || []).filter((u: any) =>
          ['therapist', 'owner', 'admin'].includes(u.role) && u.is_active
        )
      );
      setLocations((locRes.data || []).filter((l: Location) => l.is_active));
    } catch {} finally { setLoading(false); }
  }

  async function handleCreateAppointment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const date = fd.get('date') as string;
    const startTime = fd.get('startTime') as string;
    const endTime = fd.get('endTime') as string;
    try {
      const locationId = fd.get('locationId') as string;
      await api.post('/scheduling', {
        patientId: fd.get('patientId'),
        therapistId: fd.get('therapistId'),
        locationId: locationId || null,
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

  // ── Appointment card (reused across views) ──
  function AppointmentCard({ appt, compact }: { appt: Appointment; compact?: boolean }) {
    return (
      <div className={`text-xs p-1.5 rounded mb-1 border ${statusClasses(appt.status)}`}>
        <div className="font-medium">
          <Link to={`/app/patients/${appt.patient_id}`} className="hover:underline">
            {appt.patient_last_name}, {appt.patient_first_name}
          </Link>
        </div>
        <div className="text-slate-500">
          {format(new Date(appt.start_time), 'h:mm')}-{format(new Date(appt.end_time), 'h:mma')}
          {appt.location_name && <span className="ml-1 text-slate-400">@ {appt.location_name}</span>}
        </div>
        {!compact && (
          <div className="mt-1 flex gap-1 flex-wrap">
            {appt.status === 'scheduled' && <button onClick={() => updateStatus(appt.id, 'checked_in')} className="text-blue-600 underline">Check In</button>}
            {appt.status === 'checked_in' && <button onClick={() => updateStatus(appt.id, 'in_progress')} className="text-blue-600 underline">Start</button>}
            {appt.status === 'in_progress' && <button onClick={() => updateStatus(appt.id, 'completed')} className="text-green-600 underline">Complete</button>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header / Controls ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-bold flex-1 min-w-0">Schedule</h1>
          <button onClick={() => setShowNewForm(!showNewForm)} className="btn-primary text-sm">+ New</button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setCurrentDate(d => view === 'month' ? addMonths(d, -1) : addDays(d, view === 'week' ? -7 : -1))} className="btn-ghost px-2">←</button>
          <button onClick={() => setCurrentDate(new Date())} className="btn-ghost text-sm px-2">Today</button>
          <button onClick={() => setCurrentDate(d => view === 'month' ? addMonths(d, 1) : addDays(d, view === 'week' ? 7 : 1))} className="btn-ghost px-2">→</button>
          <span className="text-sm font-medium">{view === 'month' ? format(currentDate, 'MMMM yyyy') : format(currentDate, 'MMMM d, yyyy')}</span>
          <div className="flex border rounded-lg overflow-hidden ml-auto">
            {(['day', 'week', 'month'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 text-sm capitalize ${view === v ? 'bg-primary-600 text-white' : 'bg-white'}`}>{v}</button>
            ))}
          </div>
        </div>

        {/* Location filter (shown when clinic has multiple locations) */}
        {locations.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap">Location:</label>
            <select
              value={selectedLocationId}
              onChange={e => setSelectedLocationId(e.target.value)}
              className="input text-sm py-1"
            >
              <option value="all">All Locations</option>
              {locations.map(loc => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Mobile provider picker (day view only, shown on small screens) */}
        {view === 'day' && (
          <div className="md:hidden">
            <select
              value={mobileProviderId}
              onChange={e => setMobileProviderId(e.target.value)}
              className="input w-full"
            >
              <option value="all">All Providers</option>
              {providers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.last_name}, {p.first_name} ({p.credential})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ── New Appointment Form ── */}
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
            <label className="label">Provider *</label>
            <select name="therapistId" required className="input">
              <option value="">Select provider...</option>
              {providers.map(t => <option key={t.id} value={t.id}>{t.last_name}, {t.first_name} ({t.credential})</option>)}
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
          {locations.length > 0 && (
            <div>
              <label className="label">Location</label>
              <select name="locationId" className="input" defaultValue={selectedLocationId !== 'all' ? selectedLocationId : ''}>
                <option value="">No location</option>
                {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
              </select>
            </div>
          )}
          <div><label className="label">Date *</label><input name="date" type="date" required className="input" defaultValue={format(currentDate, 'yyyy-MM-dd')} /></div>
          <div><label className="label">Start Time *</label><input name="startTime" type="time" required className="input" defaultValue="09:00" /></div>
          <div><label className="label">End Time *</label><input name="endTime" type="time" required className="input" defaultValue="09:45" /></div>
          <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowNewForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create Appointment</button>
          </div>
        </form>
      )}

      {/* ── Loading ── */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
      ) : view === 'month' ? (
        /* ═══════════ MONTH VIEW ═══════════ */
        (() => {
          const monthStart = startOfMonth(currentDate);
          const monthEnd = endOfMonth(currentDate);
          const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
          const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
          const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
          const weeks: Date[][] = [];
          for (let i = 0; i < calendarDays.length; i += 7) {
            weeks.push(calendarDays.slice(i, i + 7));
          }
          return (
            <div className="card overflow-x-auto p-0">
              <div className="grid grid-cols-7 min-w-[320px]">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                  <div key={d} className="border-b bg-slate-50 p-1 sm:p-2 text-center text-xs font-medium text-slate-500">{d}</div>
                ))}
                {weeks.map(week =>
                  week.map(day => {
                    const dayAppts = appointments.filter(a => isSameDay(new Date(a.start_time), day));
                    const inMonth = isSameMonth(day, currentDate);
                    return (
                      <div
                        key={day.toISOString()}
                        className={`border-b border-r min-h-[60px] sm:min-h-[100px] p-1 sm:p-1.5 cursor-pointer ${
                          isToday(day) ? 'bg-primary-50' : inMonth ? 'bg-white' : 'bg-slate-50'
                        }`}
                        onClick={() => { setCurrentDate(day); setView('day'); }}
                      >
                        <div className={`text-xs mb-0.5 ${isToday(day) ? 'font-bold text-primary-600' : inMonth ? 'text-slate-700' : 'text-slate-400'}`}>
                          {format(day, 'd')}
                        </div>
                        {/* On mobile just show dot indicators */}
                        <div className="hidden sm:block">
                          {dayAppts.slice(0, 3).map(appt => (
                            <div
                              key={appt.id}
                              className={`text-xs px-1 py-0.5 rounded mb-0.5 truncate ${monthStatusClasses(appt.status)}`}
                              onClick={(e) => { e.stopPropagation(); setCurrentDate(day); setView('day'); }}
                            >
                              {format(new Date(appt.start_time), 'h:mma')} {appt.patient_last_name}
                            </div>
                          ))}
                          {dayAppts.length > 3 && (
                            <div className="text-xs text-slate-500 px-1">+{dayAppts.length - 3} more</div>
                          )}
                        </div>
                        {/* Mobile: colored dots */}
                        {dayAppts.length > 0 && (
                          <div className="sm:hidden flex gap-0.5 flex-wrap">
                            {dayAppts.slice(0, 4).map(appt => (
                              <div key={appt.id} className={`w-1.5 h-1.5 rounded-full ${
                                appt.status === 'completed' ? 'bg-green-500' :
                                appt.status === 'cancelled' ? 'bg-red-400' :
                                appt.status === 'no_show' ? 'bg-yellow-500' :
                                'bg-primary-500'
                              }`} />
                            ))}
                            {dayAppts.length > 4 && <span className="text-[9px] text-slate-400">+{dayAppts.length - 4}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })()
      ) : view === 'day' ? (
        /* ═══════════ DAY VIEW — PROVIDER COLUMNS ═══════════ */
        (() => {
          // Desktop: show all providers as columns
          // Mobile: show single selected provider (or all as a list)
          const visibleProviders = providers.length > 0 ? providers : [{ id: '__all', first_name: '', last_name: 'All', credential: null, role: '' }];
          const mobileFiltered = mobileProviderId === 'all'
            ? visibleProviders
            : visibleProviders.filter(p => p.id === mobileProviderId);

          return (
            <>
              {/* ── Desktop: multi-column grid ── */}
              <div className="hidden md:block card overflow-x-auto p-0">
                <div className="grid min-w-[600px]" style={{ gridTemplateColumns: `60px repeat(${visibleProviders.length}, 1fr)` }}>
                  {/* Provider headers */}
                  <div className="border-b border-r bg-slate-50 p-2" />
                  {visibleProviders.map(prov => (
                    <div key={prov.id} className="border-b border-r bg-slate-50 p-2 text-center">
                      <div className="text-sm font-medium truncate">{prov.last_name}, {prov.first_name}</div>
                      {prov.credential && <div className="text-xs text-slate-500">{prov.credential}</div>}
                    </div>
                  ))}

                  {/* Time rows */}
                  {hours.map(hour => (
                    <div key={`row-${hour}`} className="contents">
                      <div className="border-r border-b p-1 text-xs text-slate-400 text-right pr-2">
                        {hour > 12 ? hour - 12 : hour}{hour >= 12 ? 'p' : 'a'}
                      </div>
                      {visibleProviders.map(prov => {
                        const cellAppts = appointments.filter(a => {
                          const d = new Date(a.start_time);
                          return d.getHours() === hour && a.therapist_id === prov.id;
                        });
                        return (
                          <div key={`${prov.id}-${hour}`} className="border-b border-r min-h-[60px] p-1">
                            {cellAppts.map(appt => <AppointmentCard key={appt.id} appt={appt} />)}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Mobile: single-column schedule ── */}
              <div className="md:hidden card p-0">
                {mobileFiltered.length === 0 ? (
                  <div className="p-4 text-sm text-slate-500 text-center">No providers found</div>
                ) : mobileProviderId === 'all' ? (
                  /* All providers — stacked sections */
                  <div className="divide-y">
                    {visibleProviders.map(prov => {
                      const provAppts = appointments
                        .filter(a => a.therapist_id === prov.id)
                        .sort((a, b) => a.start_time.localeCompare(b.start_time));
                      return (
                        <div key={prov.id} className="p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium text-sm">{prov.last_name}, {prov.first_name}</span>
                            {prov.credential && <span className="badge-blue text-xs">{prov.credential}</span>}
                            <span className="text-xs text-slate-400 ml-auto">{provAppts.length} appts</span>
                          </div>
                          {provAppts.length === 0 ? (
                            <div className="text-xs text-slate-400">No appointments</div>
                          ) : (
                            <div className="space-y-1">
                              {provAppts.map(appt => <AppointmentCard key={appt.id} appt={appt} />)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Single provider — time grid */
                  <div>
                    {hours.map(hour => {
                      const cellAppts = appointments.filter(a => {
                        const d = new Date(a.start_time);
                        return d.getHours() === hour && a.therapist_id === mobileProviderId;
                      });
                      return (
                        <div key={hour} className="flex border-b">
                          <div className="w-12 shrink-0 border-r p-1 text-xs text-slate-400 text-right pr-2">
                            {hour > 12 ? hour - 12 : hour}{hour >= 12 ? 'p' : 'a'}
                          </div>
                          <div className="flex-1 min-h-[56px] p-1">
                            {cellAppts.map(appt => <AppointmentCard key={appt.id} appt={appt} />)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          );
        })()
      ) : (
        /* ═══════════ WEEK VIEW ═══════════ */
        <div className="card overflow-x-auto p-0">
          <div className="grid grid-cols-[50px_repeat(7,1fr)] sm:grid-cols-[60px_repeat(7,1fr)] min-w-[600px]">
            {/* Header */}
            <div className="border-b border-r bg-slate-50 p-1 sm:p-2" />
            {weekDays.map(day => (
              <div
                key={day.toISOString()}
                className={`border-b border-r p-1 sm:p-2 text-center text-sm cursor-pointer ${isToday(day) ? 'bg-primary-50 font-bold' : 'bg-slate-50'}`}
                onClick={() => { setCurrentDate(day); setView('day'); }}
              >
                <div className="text-xs text-slate-500">{format(day, 'EEE')}</div>
                <div>{format(day, 'd')}</div>
              </div>
            ))}

            {/* Time slots */}
            {hours.map(hour => (
              <div key={`row-${hour}`} className="contents">
                <div className="border-r border-b p-1 text-xs text-slate-400 text-right pr-2">
                  {hour > 12 ? hour - 12 : hour}{hour >= 12 ? 'p' : 'a'}
                </div>
                {weekDays.map(day => {
                  const dayAppts = appointments.filter(a => {
                    const apptDate = new Date(a.start_time);
                    return isSameDay(apptDate, day) && apptDate.getHours() === hour;
                  });
                  return (
                    <div key={`${day.toISOString()}-${hour}`} className="border-b border-r min-h-[60px] p-1">
                      {dayAppts.map(appt => <AppointmentCard key={appt.id} appt={appt} compact />)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
