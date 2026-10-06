import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { portalApi } from './portalApi';

export default function PatientRegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    portal_code: '',
    first_name: '',
    last_name: '',
    date_of_birth: '',
    gender: 'unknown',
    email: '',
    phone: '',
    password: '',
    confirm: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (form.password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    setLoading(true);
    try {
      const data = await portalApi<{ clinic_name: string; message: string }>('/portal/register', {
        method: 'POST',
        body: {
          portal_code: form.portal_code.trim(),
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          date_of_birth: form.date_of_birth,
          gender: form.gender,
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          password: form.password,
        },
      });
      setSuccess(`${data.message} (${data.clinic_name})`);
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputCls = 'input';

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="card">
          <h1 className="text-2xl font-bold text-slate-900">Create Portal Account</h1>
          <p className="text-sm text-slate-500 mt-1">
            Register for online access to your clinic. Your clinic will verify your identity before activating your account.
          </p>

          {success ? (
            <div className="mt-6">
              <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded px-3 py-3" role="alert">
                {success}
              </div>
              <button
                onClick={() => navigate('/portal-login')}
                className="btn-primary w-full min-h-[44px] mt-4"
              >
                Back to Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="label" htmlFor="reg-code">Clinic Code</label>
                <input
                  id="reg-code"
                  className={inputCls}
                  required
                  value={form.portal_code}
                  onChange={(e) => set('portal_code', e.target.value)}
                  placeholder="e.g. FOX1234"
                  autoComplete="off"
                />
                <p className="text-xs text-slate-400 mt-1">Ask your clinic's front desk for this code.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="reg-first">First Name</label>
                  <input id="reg-first" className={inputCls} required value={form.first_name} onChange={(e) => set('first_name', e.target.value)} autoComplete="given-name" />
                </div>
                <div>
                  <label className="label" htmlFor="reg-last">Last Name</label>
                  <input id="reg-last" className={inputCls} required value={form.last_name} onChange={(e) => set('last_name', e.target.value)} autoComplete="family-name" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="reg-dob">Date of Birth</label>
                  <input id="reg-dob" type="date" className={inputCls} required value={form.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} autoComplete="bday" />
                </div>
                <div>
                  <label className="label" htmlFor="reg-gender">Gender</label>
                  <select id="reg-gender" className={inputCls} value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="unknown">Prefer not to say</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="reg-email">Email</label>
                <input id="reg-email" type="email" className={inputCls} required value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" autoComplete="email" />
              </div>
              <div>
                <label className="label" htmlFor="reg-phone">Phone (optional)</label>
                <input id="reg-phone" type="tel" className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(555) 123-4567" autoComplete="tel" />
              </div>
              <div>
                <label className="label" htmlFor="reg-pass">Password</label>
                <input id="reg-pass" type="password" className={inputCls} required value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="At least 12 characters" autoComplete="new-password" />
              </div>
              <div>
                <label className="label" htmlFor="reg-confirm">Confirm Password</label>
                <input id="reg-confirm" type="password" className={inputCls} required value={form.confirm} onChange={(e) => set('confirm', e.target.value)} autoComplete="new-password" />
              </div>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2" role="alert">
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading} className="btn-primary w-full min-h-[44px]">
                {loading ? 'Creating account…' : 'Create Account'}
              </button>
            </form>
          )}

          <p className="text-xs text-slate-400 mt-4 text-center">
            Already have an account? <Link to="/portal-login" className="underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
