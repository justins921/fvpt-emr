import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../services/api';

interface Patient {
  id: string;
  mrn: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  phone: string;
  email: string;
  primary_diagnosis_icd10: string;
  is_active: boolean;
}

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showNewForm, setShowNewForm] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get('new') === '1') setShowNewForm(true);
  }, [searchParams]);

  useEffect(() => {
    loadPatients();
  }, [page, search]);

  async function loadPatients() {
    setLoading(true);
    try {
      const res = await api.get<any>(`/patients?page=${page}&limit=25${search ? `&search=${encodeURIComponent(search)}` : ''}`);
      setPatients(res.data || []);
      setTotal(res.meta?.total || 0);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePatient(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/patients', {
        firstName: form.get('firstName'),
        lastName: form.get('lastName'),
        dateOfBirth: form.get('dateOfBirth'),
        gender: form.get('gender'),
        phone: form.get('phone') || null,
        email: form.get('email') || null,
      });
      setShowNewForm(false);
      loadPatients();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to create patient');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900 flex-1">Patients</h1>
        <div className="flex gap-2">
          <input
            type="search"
            placeholder="Search patients..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="input max-w-xs"
          />
          <button onClick={() => setShowNewForm(!showNewForm)} className="btn-primary whitespace-nowrap">
            + New Patient
          </button>
        </div>
      </div>

      {/* New patient form */}
      {showNewForm && (
        <form onSubmit={handleCreatePatient} className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="label">First Name *</label>
            <input name="firstName" required className="input" />
          </div>
          <div>
            <label className="label">Last Name *</label>
            <input name="lastName" required className="input" />
          </div>
          <div>
            <label className="label">Date of Birth *</label>
            <input name="dateOfBirth" type="date" required className="input" />
          </div>
          <div>
            <label className="label">Gender *</label>
            <select name="gender" required className="input">
              <option value="">Select...</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="label">Phone</label>
            <input name="phone" type="tel" className="input" />
          </div>
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" className="input" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowNewForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create Patient</button>
          </div>
        </form>
      )}

      {/* Patient list */}
      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
        ) : patients.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            {search ? 'No patients found matching your search' : 'No patients yet. Create your first patient above.'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-slate-500">MRN</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-500">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-500 hidden md:table-cell">DOB</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-500 hidden lg:table-cell">Phone</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-500 hidden lg:table-cell">Dx</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {patients.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link to={`/patients/${p.id}`} className="text-primary-600 hover:underline font-mono text-xs">
                          {p.mrn}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/patients/${p.id}`} className="font-medium text-slate-900 hover:text-primary-600">
                          {p.last_name}, {p.first_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-slate-500">
                        {new Date(p.date_of_birth).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-slate-500">{p.phone || '-'}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-slate-500 font-mono text-xs">{p.primary_diagnosis_icd10 || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={p.is_active ? 'badge-green' : 'badge-gray'}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <div className="text-sm text-slate-500">{total} patient{total !== 1 ? 's' : ''}</div>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-ghost text-sm">Previous</button>
                <button disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)} className="btn-ghost text-sm">Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
