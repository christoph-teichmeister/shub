// Typed HTTP client over the ROUTES table in shared/api.ts.
import { ROUTES } from '../../../../shared/api.ts';
import { deviceToken, here, selectedOrigin } from './device.ts';

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
  /** Another machine than the one the app shows (e.g. pushing the subscription to every machine). */
  origin?: string;
  /** Return the body as a Blob (images) instead of JSON or text. */
  blob?: boolean;
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
  const origin = options.origin ?? (await selectedOrigin());
  const url =
    (origin === here ? '' : origin) + (options.query ? `${path}?${new URLSearchParams(options.query)}` : path);
  const init: RequestInit = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  const { body } = options;
  if (body instanceof Blob) {
    init.body = body;
    init.headers = {
      ...init.headers,
      'Content-Type': body.type || 'application/octet-stream',
      ...(body instanceof File && { 'X-Filename': encodeURIComponent(body.name) }),
    };
  } else if (typeof body === 'string') {
    init.body = body;
    init.headers = { ...init.headers, 'Content-Type': 'text/plain; charset=utf-8' };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
  }
  const res = await send(origin, url, init);
  const isJson = res.headers.get('content-type')?.includes('application/json');
  if (options.blob && res.ok) return (await res.blob()) as T;
  const data: unknown = res.status === 204 ? null : isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const error = data && typeof data === 'object' ? (data as { error?: unknown }).error : data;
    const message = error ? String(error) : res.statusText;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

/** This device's short-lived token for a machine; null without a key (first visit) or when it cannot sign in. */
const bearer = (origin: string, fresh = false) => deviceToken(origin, fresh).catch(() => null);

/** fetch with the device's token; a 401 gets one retry with a freshly signed token. */
async function send(origin: string, url: string, init: RequestInit): Promise<Response> {
  const token = await bearer(origin);
  if (!token) return fetch(url, init);
  const withToken = (t: string) => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${t}` } });
  const res = await withToken(token);
  if (res.status !== 401) return res;
  const again = await bearer(origin, true);
  return again ? withToken(again) : res;
}

/**
 * Where a WebSocket for `path` goes: the shown machine, with the phone's token as a subprotocol
 * (browsers cannot set headers on a WebSocket).
 */
export async function wsTarget(path: string): Promise<{ url: string; protocols?: string[] }> {
  const origin = await selectedOrigin();
  const token = await bearer(origin);
  return {
    url: origin.replace(/^http/, 'ws') + path,
    protocols: token ? ['shub', `bearer.${token}`] : undefined,
  };
}
