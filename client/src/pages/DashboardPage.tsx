import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../hooks/useAuth';

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ patients: 0, todayAppts: 0, pendingClaims: 0 });
  const [todayAppointments, setTodayAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

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

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {user?.firstName}
        </h1>
        <p className="text-slate-500 mt-1">Here's your overview for today</p>
      </div>

      {/* Stats cards */}
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

      {/* Today's schedule */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Today's Schedule</h2>
        {todayAppointments.length === 0 ? (
          <p className="text-slate-500 text-sm py-4 text-center">No appointments scheduled for today</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {todayAppointments.map((appt: any) => (
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

      {/* Quick actions */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Link to="/app/patients?new=1" className="btn-secondary text-center text-sm">New Patient</Link>
          <Link to="/app/schedule" className="btn-secondary text-center text-sm">Schedule Appt</Link>
          <Link to="/app/billing" className="btn-secondary text-center text-sm">View Claims</Link>
          <Link to="/app/admin" className="btn-secondary text-center text-sm">Admin Panel</Link>
        </div>
      </div>
    </div>
  );
}
