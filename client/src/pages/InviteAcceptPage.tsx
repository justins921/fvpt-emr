import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface InviteInfo {
  email: string;
  role: string;
  clinicName: string;
  expiresAt: string;
}

function roleLabel(r: string) {
  return r.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const setSession = useAuth(s => s.setSession);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function validate() {
      try {
        const res = await api.get<{ success: boolean; data: InviteInfo }>(`/invites/${token}/validate`);
        setInvite(res.data);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : 'This invite link is invalid.');
      } finally {
        setLoading(false);
      }
    }
    validate();
  }, [token]);

  async function handleAccept(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError('');
    const fd = new FormData(e.currentTarget);
    const password = (fd.get('password') as string) || '';
    const confirm = (fd.get('confirmPassword') as string) || '';
    if (password !== confirm) {
      setSubmitError('Passwords do not match.');
      return;
    }
    if (password.length < 12) {
      setSubmitError('Password must be at least 12 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{
        success: boolean;
        data: { accessToken: string; user: any };
      }>(`/invites/${token}/accept`, {
        firstName: (fd.get('firstName') as string)?.trim(),
        lastName: (fd.get('lastName') as string)?.trim(),
        password,
      });
      setSession(res.data.user, res.data.accessToken);
      navigate('/app', { replace: true });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Failed to create your account.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="card max-w-md w-full space-y-4">
        <div>
          <h1 className="text-xl font-bold">You're invited!</h1>
          {invite && (
            <p className="text-sm text-slate-500 mt-1">
              Join <span className="font-medium text-slate-700">{invite.clinicName}</span> as{' '}
              <span className="font-medium text-slate-700">{roleLabel(invite.role)}</span>
            </p>
          )}
        </div>

        {loadError ? (
          <div className="space-y-3">
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{loadError}</p>
            <Link to="/login" className="btn-secondary w-full text-center block">Go to Sign In</Link>
          </div>
        ) : (
          <form onSubmit={handleAccept} className="space-y-3">
            <div>
              <label className="label">Email</label>
              <input className="input bg-slate-50" value={invite?.email || ''} disabled readOnly />
              <p className="text-xs text-slate-400 mt-1">This will be your sign-in username.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">First Name *</label><input name="firstName" required maxLength={100} className="input" autoComplete="given-name" /></div>
              <div><label className="label">Last Name *</label><input name="lastName" required maxLength={100} className="input" autoComplete="family-name" /></div>
            </div>
            <div><label className="label">Password *</label><input name="password" type="password" required minLength={12} maxLength={128} className="input" autoComplete="new-password" /></div>
            <div><label className="label">Confirm Password *</label><input name="confirmPassword" type="password" required minLength={12} maxLength={128} className="input" autoComplete="new-password" /></div>
            <p className="text-xs text-slate-400">At least 12 characters.</p>
            {submitError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{submitError}</p>}
            <button type="submit" disabled={submitting} className="btn-primary w-full disabled:opacity-50">
              {submitting ? 'Creating your account…' : 'Create Account & Sign In'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
