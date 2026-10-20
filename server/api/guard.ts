// Host and Origin allow-lists against DNS rebinding and CSRF.
// Only loopback on our port and the host of the public URL (e.g. the tailscale serve name) may talk to shub.
import type { IncomingMessage } from 'node:http';

export interface Allowed {
  hosts: Set<string>;
  origins: Set<string>;
}

export function allowList(port: number, publicUrl?: string): Allowed {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (publicUrl) {
    const url = new URL(publicUrl);
    hosts.add(url.host.toLowerCase());
    origins.add(url.origin.toLowerCase());
  }
  return { hosts, origins };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Returns why the request must be refused, or null.
 * A foreign Origin is always refused; a request carrying a cookie must name an allowed Origin
 * when it changes state or upgrades to a WebSocket (browsers always send Origin there).
 * Bearer clients (CLI, sessions, plugins) send neither cookie nor Origin and pass.
 */
export function refuse(req: IncomingMessage, allowed: Allowed, upgrade = false): string | null {
  if (!allowed.hosts.has((req.headers.host ?? '').toLowerCase())) return 'unknown host';
  const origin = req.headers.origin?.toLowerCase();
  if (origin && !allowed.origins.has(origin)) return 'foreign origin';
  const changesState = upgrade || !SAFE_METHODS.has(req.method ?? 'GET');
  if (changesState && req.headers.cookie && !origin) return 'missing origin';
  return null;
}
