// Typed HTTP client over the ROUTES table in shared/api.ts.
import { ROUTES } from '../../../../shared/api.ts';
import { deviceToken } from './device.ts';

export type RouteName = keyof typeof ROUTES;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, string>;
  /** Plain objects go as JSON; strings as text/plain; Blobs as-is with their own type. */
  body?: unknown;
}

/** Method and path for a route, with `:params` filled in (URL-encoded). */
export function resolve(name: RouteName, params: Record<string, string> = {}): { method: string; path: string } {
  const [method, template] = ROUTES[name].split(' ');
  const path = template.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    if (!(key in params)) throw new Error(`Missing param ${key} for ${name}`);
    return encodeURIComponent(params[key]);
  });
  return { method, path };
}

export async function api<T = unknown>(name: RouteName, options: CallOptions = {}): Promise<T> {
  const { method, path } = resolve(name, options.params);
  const url = options.query ? `${path}?${new URLSearchParams(options.query)}` : path;
  const init: RequestInit = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  const { body } = options;
  if (body instanceof Blob) {
    init.body = body;
    init.headers = { ...init.headers, 'Content-Type': body.type || 'application/octet-stream' };
  } else if (typeof body === 'string') {
    init.body = body;
    init.headers = { ...init.headers, 'Content-Type': 'text/plain; charset=utf-8' };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
  }
  const res = await send(url, init);
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data: unknown = res.status === 204 ? null : isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const error = data && typeof data === 'object' ? (data as { error?: unknown }).error : data;
    const message = error ? String(error) : res.statusText;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

/** A paired phone's short-lived token; null on a desktop (cookie) or when the phone cannot sign in. */
const bearer = (fresh = false) => deviceToken(fresh).catch(() => null);

/** fetch with the phone's token; a 401 gets one retry with a freshly signed token. */
async function send(url: string, init: RequestInit): Promise<Response> {
  const token = await bearer();
  if (!token) return fetch(url, init);
  const withToken = (t: string) => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${t}` } });
  const res = await withToken(token);
  if (res.status !== 401) return res;
  const again = await bearer(true);
  return again ? withToken(again) : res;
}

/** WebSocket subprotocols carrying the phone's token (browsers cannot set headers on a WebSocket). */
export async function wsProtocols(): Promise<string[] | undefined> {
  const token = await bearer();
  return token ? ['shub', `bearer.${token}`] : undefined;
}

/** ws(s):// URL for a path on this origin. */
export function wsUrl(path: string): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
}
