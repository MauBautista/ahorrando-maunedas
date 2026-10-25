import type { AuthPort } from './auth';

/** The client schema the web speaks (03 §1), like Android's `CLIENT_SCHEMA`. */
export const CLIENT_SCHEMA = 1;

/** An error answer of the API (03 §1.2): clients decide by `code`; `message` is shown as is. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The account was removed or disabled by the admin (02 §5.3): the session ends there. */
const SESSION_ENDING = new Set(['USER_NOT_ALLOWED', 'USER_DISABLED']);

export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

/**
 * The HTTP client of 06 §4: same origin as the Worker (no CORS), the Firebase ID token on every request, one retry
 * with a fresh token after a 401, and typed errors. A network failure is an `ApiError` with status 0.
 */
export function createApi(
  auth: AuthPort,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Api {
  async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const token = await auth.idToken(!retry);
    let res: Response;
    try {
      res = await fetchImpl(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Schema': String(CLIENT_SCHEMA),
          'X-Client-Version': __APP_VERSION__,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Sin conexión. Revisa tu internet e intenta de nuevo.');
    }
    if (res.status === 401 && retry && auth.currentUser()) return request<T>(method, path, body, false);
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (!res.ok) {
      const e = json.error ?? {};
      if (e.code && SESSION_ENDING.has(e.code)) await auth.signOut();
      throw new ApiError(
        res.status,
        e.code ?? 'INTERNAL',
        e.message ?? 'Ocurrió un error inesperado.',
        e.details,
      );
    }
    return json as T;
  }
  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    patch: (p, b) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
  };
}
