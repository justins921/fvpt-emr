import { create } from 'zustand';
import { api } from '../services/api';

interface Clinic {
  id: string;
  name: string;
  npi?: string;
  city?: string;
  state?: string;
}

interface User {
  id: string;
  clinicId: string;
  homeClinicId?: string;
  clinicName?: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  npi?: string;
  mfaEnabled?: boolean;
  clinics?: Clinic[];
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  mfaPending: boolean;
  mfaToken: string | null;
  isSwitchingClinic: boolean;
  login: (username: string, password: string) => Promise<void>;
  completeMfa: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  switchClinic: (clinicId: string) => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  mfaPending: false,
  mfaToken: null,
  isSwitchingClinic: false,

  login: async (username: string, password: string) => {
    const response = await api.post<{
      success: boolean;
      data: {
        accessToken?: string;
        mfaRequired?: boolean;
        mfaToken?: string;
        user: User;
      };
    }>('/auth/login', { username, password });

    if (response.success && response.data) {
      if (response.data.mfaRequired) {
        // MFA step required — store token and wait for code
        set({
          mfaPending: true,
          mfaToken: response.data.mfaToken || null,
          user: response.data.user,
        });
        return;
      }
      // No MFA — login complete. Refresh token is set as HTTP-only cookie by server.
      if (response.data.accessToken) {
        api.setAccessToken(response.data.accessToken);
      }
      set({ user: response.data.user, isAuthenticated: true, mfaPending: false, mfaToken: null });
    } else {
      throw new Error('Login failed');
    }
  },

  completeMfa: async (code: string) => {
    const { mfaToken } = get();
    if (!mfaToken) throw new Error('No MFA session');

    const response = await api.post<{
      success: boolean;
      data: { accessToken: string; user: User };
    }>('/auth/mfa/verify-login', { mfaToken, code });

    if (response.success && response.data) {
      api.setAccessToken(response.data.accessToken);
      set({
        user: response.data.user,
        isAuthenticated: true,
        mfaPending: false,
        mfaToken: null,
      });
    } else {
      throw new Error('Invalid MFA code');
    }
  },

  logout: async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    api.clearTokens();
    set({ user: null, isAuthenticated: false, mfaPending: false, mfaToken: null });
  },

  checkAuth: async () => {
    try {
      // Try to refresh — the HTTP-only cookie is sent automatically
      const refreshRes = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        if (data.success && data.data?.accessToken) {
          api.setAccessToken(data.data.accessToken);
          // Fetch user profile (includes clinics for dev users)
          const meRes = await api.get<{ success: boolean; data: User }>('/auth/me');
          if (meRes.success && meRes.data) {
            set({ user: meRes.data, isAuthenticated: true, isLoading: false });
            return;
          }
        }
      }
      set({ isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  switchClinic: async (clinicId: string) => {
    set({ isSwitchingClinic: true });
    try {
      const response = await api.post<{
        success: boolean;
        data: { accessToken: string; user: User };
      }>('/auth/switch-clinic', { clinicId });

      if (response.success && response.data) {
        api.setAccessToken(response.data.accessToken);
        // Fetch full user profile with clinic list
        const meRes = await api.get<{ success: boolean; data: User }>('/auth/me');
        if (meRes.success && meRes.data) {
          set({ user: meRes.data, isSwitchingClinic: false });
        } else {
          set({ user: response.data.user, isSwitchingClinic: false });
        }
      }
    } catch {
      set({ isSwitchingClinic: false });
    }
  },
}));
