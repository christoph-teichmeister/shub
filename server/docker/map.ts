// Pure mapping of Docker Engine API responses to shub's shapes. index.ts does the socket I/O.
import type { ServiceContainer } from '../../shared/api.ts';

export interface EngineContainer {
  Id: string;
  Names?: string[];
  Image: string;
  State: string;
  Status: string;
  Ports?: { PrivatePort: number; PublicPort?: number; Type?: string }[];
  Labels?: Record<string, string>;
}

export interface EngineStats {
  cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; stats?: Record<string, number> };
}

export interface LogLine {
  stream: 'stdout' | 'stderr';
  /** ISO timestamp from Docker, or null when the line had none. */
  at: string | null;
  text: string;
}

const WORKING_DIR = 'com.docker.compose.project.working_dir';
const STATES = new Set(['running', 'exited', 'restarting', 'paused', 'created', 'dead']);

export const normalizeDir = (dir: string): string => dir.replace(/\/+$/, '') || '/';

export function belongsTo(container: EngineContainer, cwd: string): boolean {
  const dir = container.Labels?.[WORKING_DIR];
  return dir !== undefined && normalizeDir(dir) === normalizeDir(cwd);
}

// Order matters: a "celery" worker image is usually a python image, so workers are checked first.
const KIND_PATTERNS: [ServiceContainer['kind'], RegExp][] = [
  ['postgres', /postgres|postgis|pgvector/],
  ['redis', /redis|valkey/],
  ['rabbitmq', /rabbit/],
  ['celery', /celery|worker|beat|flower/],
  ['nginx', /nginx|caddy|traefik/],
  ['node', /node|vite|next|frontend/],
  ['python', /python|django|backend|web|api|uvicorn|gunicorn/],
];

export function kindOf(image: string, service: string): ServiceContainer['kind'] {
  const haystack = `${service} ${image}`.toLowerCase();
  return KIND_PATTERNS.find(([, re]) => re.test(haystack))?.[0] ?? 'other';
}

export function toServiceContainer(c: EngineContainer): ServiceContainer {
  const labels = c.Labels ?? {};
  const service = labels['com.docker.compose.service'] ?? c.Names?.[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12);
  const ports = new Map<string, { host: number; container: number }>();
  // Docker lists a published port once per address family; dedupe by host:container.
  for (const p of c.Ports ?? []) {
    if (p.PublicPort) ports.set(`${p.PublicPort}:${p.PrivatePort}`, { host: p.PublicPort, container: p.PrivatePort });
  }
  return {
    id: c.Id,
    name: service,
    project: labels['com.docker.compose.project'] ?? '',
    workingDir: labels[WORKING_DIR] ?? '',
    image: c.Image,
    kind: kindOf(c.Image, service),
    state: (STATES.has(c.State) ? c.State : 'dead') as ServiceContainer['state'],
    status: c.Status,
    ports: [...ports.values()].sort((a, b) => a.host - b.host),
  };
}

export function cpuPercent(s: EngineStats): number | undefined {
  const cpu = (s.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const system = (s.cpu_stats?.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
  if (!s.precpu_stats?.system_cpu_usage || system <= 0 || cpu < 0) return undefined;
  return Math.round((cpu / system) * (s.cpu_stats?.online_cpus ?? 1) * 1000) / 10;
}

export function memBytes(s: EngineStats): number | undefined {
  const usage = s.memory_stats?.usage;
  if (usage === undefined) return undefined;
  // Same as `docker stats`: page cache does not count (cgroup v2: inactive_file, v1: cache).
  const stats = s.memory_stats?.stats ?? {};
  return usage - (stats.inactive_file ?? stats.cache ?? 0);
}

/** Docker multiplexes non-TTY logs as frames: [stream, 0, 0, 0, size (uint32 BE)] + payload. */
export function demux(buf: Buffer): { stream: 'stdout' | 'stderr'; data: string }[] {
  if (!isMultiplexed(buf)) return [{ stream: 'stdout', data: buf.toString('utf8') }];
  const frames: { stream: 'stdout' | 'stderr'; data: string }[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + size).toString('utf8');
    frames.push({ stream: buf[offset] === 2 ? 'stderr' : 'stdout', data });
    offset += 8 + size;
  }
  return frames;
}

function isMultiplexed(buf: Buffer): boolean {
  return buf.length >= 8 && buf[0] <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
}

export function parseLogs(buf: Buffer): LogLine[] {
  const lines: LogLine[] = [];
  for (const frame of demux(buf)) {
    for (const raw of frame.data.split('\n')) {
      if (raw === '') continue;
      const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (.*)$/s.exec(raw);
      lines.push({ stream: frame.stream, at: m ? m[1] : null, text: (m ? m[2] : raw).replace(/\r$/, '') });
    }
  }
  return lines;
}

const SECRET_KEY = /PASSWORD|PASSWD|SECRET|TOKEN|KEY|CREDENTIAL/i;
export const MASK = '••••••';

export function maskEnv(env: string[]): { key: string; value: string; masked: boolean }[] {
  return env.map((pair) => {
    const i = pair.indexOf('=');
    const key = i < 0 ? pair : pair.slice(0, i);
    const value = i < 0 ? '' : pair.slice(i + 1);
    if (SECRET_KEY.test(key)) return { key, value: MASK, masked: true };
    // URLs like postgres://user:pw@db/x carry a password even when the key looks harmless.
    const unpw = value.replace(/(\/\/[^/:@\s]*:)[^@\s]*@/, `$1${MASK}@`);
    return { key, value: unpw, masked: unpw !== value };
  });
}

export interface EngineInspect {
  Config?: { Env?: string[] };
  Mounts?: { Type?: string; Source?: string; Destination?: string; RW?: boolean }[];
  NetworkSettings?: { Ports?: Record<string, { HostIp?: string; HostPort?: string }[] | null> };
}

export interface ServiceInspect {
  env: { key: string; value: string; masked: boolean }[];
  mounts: { type: string; source: string; destination: string; rw: boolean }[];
  ports: { container: string; host: string[] }[];
}

export function toInspect(i: EngineInspect): ServiceInspect {
  return {
    env: maskEnv(i.Config?.Env ?? []),
    mounts: (i.Mounts ?? []).map((m) => ({
      type: m.Type ?? '',
      source: m.Source ?? '',
      destination: m.Destination ?? '',
      rw: m.RW ?? false,
    })),
    ports: Object.entries(i.NetworkSettings?.Ports ?? {}).map(([container, bindings]) => ({
      container,
      host: [...new Set((bindings ?? []).map((b) => b.HostPort ?? '').filter(Boolean))],
    })),
  };
}
