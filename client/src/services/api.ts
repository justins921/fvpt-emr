const API_BASE = '/api';

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  setTokens(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    localStorage.setItem('refreshToken', refreshToken);
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('refreshToken');
  }

  getStoredRefreshToken(): string | null {
    return this.refreshToken || localStorage.getItem('refreshToken');
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {} } = options;

    const reqHeaders: Record<string, string> = {
      ...headers,
    };

    if (this.accessToken) {
      reqHeaders['Authorization'] = `Bearer ${this.accessToken}`;
    }

    if (body && !(body instanceof FormData)) {
      reqHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: reqHeaders,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401 && this.getStoredRefreshToken()) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        reqHeaders['Authorization'] = `Bearer ${this.accessToken}`;
        const retryResponse = await fetch(`${API_BASE}${path}`, {
          method,
          headers: reqHeaders,
          body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
        });
        if (!retryResponse.ok) {
          const retryError = await retryResponse.json().catch(() => ({ error: 'Request failed' }));
          throw new ApiError(retryResponse.status, retryError.error || 'Request failed', retryError.details);
        }
        return retryResponse.json();
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new ApiError(response.status, error.error || 'Request failed', error.details);
    }

    if (response.headers.get('content-type')?.includes('application/json')) {
      return response.json();
    }

    return response.text() as unknown as T;
  }

  private async tryRefresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const rt = this.getStoredRefreshToken();
        if (!rt) return false;

        const response = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });

        if (!response.ok) return false;

        const data = await response.json();
        if (data.success && data.data) {
          this.setTokens(data.data.accessToken, data.data.refreshToken);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  get<T = unknown>(path: string) { return this.request<T>(path); }
  post<T = unknown>(path: string, body?: unknown) { return this.request<T>(path, { method: 'POST', body }); }
  put<T = unknown>(path: string, body?: unknown) { return this.request<T>(path, { method: 'PUT', body }); }
  patch<T = unknown>(path: string, body?: unknown) { return this.request<T>(path, { method: 'PATCH', body }); }
  delete<T = unknown>(path: string) { return this.request<T>(path, { method: 'DELETE' }); }

  upload<T = unknown>(path: string, formData: FormData) {
    return this.request<T>(path, { method: 'POST', body: formData });
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = new ApiClient();
