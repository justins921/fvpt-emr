import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { portalApi, setPortalToken, getPortalToken } from './portalApi';

export default function PatientLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Already have a portal session? Go straight in.
  useEffect(() => {
    if (getPortalToken()) {
      navigate('/portal', { replace: true });
    }
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await portalApi<{ token: string }>('/portal/patient/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      setPortalToken(data.token);
      navigate('/portal', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Sign-in failed. Check your email and password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="card">
          <h1 className="text-2xl font-bold text-slate-900">Patient Portal</h1>
          <p className="text-sm text-slate-500 mt-1">Sign in to view your home exercise program</p>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="portal-email">Email</label>
              <input
                id="portal-email"
                type="email"
                required
                autoComplete="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="label" htmlFor="portal-password">Password</label>
              <input
                id="portal-password"
                type="password"
                required
                autoComplete="current-password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2" role="alert">
                {error}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full min-h-[44px]">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          <p className="text-xs text-slate-400 mt-4 text-center">
            Don't have portal access? Ask your clinic's front desk to set it up.
          </p>
          <p className="text-xs text-slate-400 mt-2 text-center">
            <Link to="/" className="underline">Back to home</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
