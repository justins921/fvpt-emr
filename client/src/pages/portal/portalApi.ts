/**
 * Minimal fetch wrapper for the patient portal.
 *
 * Patient portal sessions use a separate JWT (type 'portal') stored in
 * localStorage so it survives page reloads on the patient's phone.
 * This is intentionally separate from the staff api client (in-memory
 * access token + refresh cookies).
 */

const TOKEN_KEY = 'portal_token';

export function getPortalToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setPortalToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — session won't persist */
  }
}

export function clearPortalToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function unwrap(res: any): any {
  if (!res) return null;
  if (res.data !== undefined) return res.data;
  return res;
}

export async function portalApi<T = any>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = 'GET', body } = options;
  const token = getPortalToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await response.json().catch(() => ({ success: false, error: 'Request failed' }));
  if (!response.ok || json.success === false) {
    throw new Error(json.error || `Request failed (${response.status})`);
  }
  return unwrap(json) as T;
}
