export interface ApiCallResult<T> {
  apiUnavailable: boolean;
  data?: T;
}

export type TokenGetter = (forceRefresh?: boolean) => Promise<string | null>;

function getConfiguredApiBase(): string {
  try {
    const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const raw = metaEnv?.VITE_API_BASE_URL || '';
    return raw.trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = getConfiguredApiBase();
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes('application/json');
}

export async function callJsonApiWithFallback<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    requireAuth?: boolean;
    getIdToken?: TokenGetter;
    cache?: RequestCache;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<ApiCallResult<T>> {
  const method = options.method || 'GET';
  const url = resolveApiUrl(path);
  const fetchFn = options.fetchImpl || fetch;

  const performFetch = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return fetchFn(url, {
      method,
      headers,
      cache: options.cache,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  };

  let token: string | null = null;
  if (options.requireAuth) {
    token = options.getIdToken ? await options.getIdToken(false).catch(() => null) : null;
    if (!token) {
      throw new Error('Authentication expired. Please sign in again.');
    }
  }

  let res: Response;
  try {
    res = await performFetch(token);
  } catch {
    return { apiUnavailable: true };
  }

  // On 401 JSON when authenticated, refresh Firebase ID token once and retry
  if (res.status === 401 && options.requireAuth && options.getIdToken) {
    const refreshed = await options.getIdToken(true).catch(() => null);
    if (refreshed) {
      try {
        res = await performFetch(refreshed);
      } catch {
        return { apiUnavailable: true };
      }
    }
  }

  const contentType = res.headers.get('content-type');

  // If static host (e.g. Cloudflare Workers SPA fallback) returns HTML or backend Admin SDK is unconfigured (503),
  // signal caller to switch seamlessly to verified Firebase Client SDK persistence instead of parsing HTML as JSON.
  if (!isJsonContentType(contentType) || res.status === 503) {
    return { apiUnavailable: true };
  }

  let payload: (T & { error?: string }) | null = null;
  try {
    payload = (await res.json()) as T & { error?: string };
  } catch {
    return { apiUnavailable: true };
  }

  if (!res.ok) {
    throw new Error(payload?.error || `Request failed with HTTP ${res.status}.`);
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Backend returned an empty JSON response.');
  }

  return { apiUnavailable: false, data: payload };
}
