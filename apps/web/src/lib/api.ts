export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The access token lives only in memory (never localStorage) so XSS cannot read a long-lived secret.
// The refresh token is an httpOnly cookie managed by the server.
let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const setSessionLostHandler = (fn: (() => void) | null) => {
  onSessionLost = fn;
};

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown; requestId?: string };
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ErrorEnvelope = {};
  try {
    body = (await res.json()) as ErrorEnvelope;
  } catch {
    /* non-JSON error body (proxy failure, etc.) */
  }
  const e = body.error ?? {};
  return new ApiError(
    res.status,
    e.code ?? 'HTTP_ERROR',
    e.message ?? `Request failed (${res.status})`,
    e.details,
    e.requestId,
  );
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      let res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      // 409: another tab rotated the cookie a moment ago. The browser now holds the new cookie, so retry once.
      if (res.status === 409) {
        await new Promise((r) => setTimeout(r, 250));
        res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      }
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry on 401 (used by the auth calls themselves). */
  noRefresh?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const res = await authorisedFetch(url, opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Sends a request with the access token, refreshing once on 401. Throws ApiError for non-2xx. */
async function authorisedFetch(url: URL, opts: RequestOptions): Promise<Response> {
  const isForm = opts.body instanceof FormData;
  const send = () =>
    fetch(url, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      signal: opts.signal,
      headers: {
        // For FormData the browser sets the multipart boundary itself.
        ...(opts.body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    });

  let res = await send();
  if (res.status === 401 && !opts.noRefresh && accessToken) {
    if (await refreshSession()) {
      res = await send();
    } else {
      accessToken = null;
      onSessionLost?.();
    }
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

export function uploadFile(file: File, category: string): Promise<{ id: number; originalName: string }> {
  const form = new FormData();
  form.set('category', category);
  form.set('file', file);
  return api('/files', { method: 'POST', body: form });
}

/** Downloads an access-controlled file. The bearer token can't ride on a plain link, so fetch then save. */
export async function downloadFile(fileId: number, fallbackName = 'download'): Promise<void> {
  const res = await authorisedFetch(new URL(`/api/v1/files/${fileId}/download`, window.location.origin), {});
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const name = match ? decodeURIComponent(match[1]!) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
