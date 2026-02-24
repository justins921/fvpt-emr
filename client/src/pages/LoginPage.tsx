import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const isDev = import.meta.env.DEV;

export default function LoginPage() {
  const { login, completeMfa, mfaPending } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await completeMfa(mfaCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-600 rounded-2xl mb-4">
            <span className="text-white text-2xl font-bold">OS</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">EMR OS</h1>
          <p className="text-slate-500 mt-1">by Sobojinski Solutions</p>
        </div>

        {mfaPending ? (
          /* ── MFA Verification Step ── */
          <form onSubmit={handleMfaSubmit} className="card space-y-4">
            <div className="text-center mb-2">
              <div className="text-3xl mb-2">&#128272;</div>
              <h2 className="text-lg font-semibold text-slate-900">Two-Factor Authentication</h2>
              <p className="text-sm text-slate-500 mt-1">
                Enter the 6-digit code from your authenticator app.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                className="input text-center text-2xl tracking-[0.5em] font-mono"
                placeholder="000000"
                required
                autoFocus
                autoComplete="one-time-code"
              />
            </div>

            <button type="submit" disabled={loading || mfaCode.length !== 6} className="btn-primary w-full">
              {loading ? 'Verifying...' : 'Verify'}
            </button>
          </form>
        ) : (
          /* ── Login Form ── */
          <form onSubmit={handleSubmit} className="card space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="username" className="label">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="input"
                placeholder="Enter your username"
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label htmlFor="password" className="label">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input"
                placeholder="Enter your password"
                required
                autoComplete="current-password"
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            {isDev && (
              <p className="text-xs text-slate-400 text-center mt-4">
                Demo: admin / password123!
              </p>
            )}
          </form>
        )}

        <div className="text-center mt-6 space-y-2">
          <p className="text-xs text-slate-400">
            Secure EMR &middot; Sobojinski Solutions
          </p>
          <Link to="/" className="text-xs text-primary-600 hover:underline">
            &larr; Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
