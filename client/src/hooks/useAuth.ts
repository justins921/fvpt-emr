import { create } from 'zustand';
import { api } from '../services/api';

interface User {
  id: string;
  clinicId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  npi?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    const response = await api.post<{ success: boolean; data: { accessToken: string; refreshToken: string; user: User } }>('/auth/login', { email, password });
    if (response.success && response.data) {
      api.setTokens(response.data.accessToken, response.data.refreshToken);
      set({ user: response.data.user, isAuthenticated: true });
    }
  },

  logout: async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    api.clearTokens();
    set({ user: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    try {
      const rt = api.getStoredRefreshToken();
      if (!rt) {
        set({ isLoading: false });
        return;
      }
      // Try to refresh the token
      const refreshRes = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        if (data.success && data.data) {
          api.setTokens(data.data.accessToken, data.data.refreshToken);
          // Fetch user profile
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
}));
