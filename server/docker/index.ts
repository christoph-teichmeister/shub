// Docker: compose containers of a session's folder via the Engine API on the unix socket.
import { request as httpRequest } from 'node:http';
import type { ServiceContainer } from '../../shared/api.ts';
import { ROUTES } from '../../shared/api.ts';
import { HttpError, requireRight, requireUser } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Docker, Services } from '../services.ts';
import {
  belongsTo,
  cpuPercent,
  memBytes,
  parseLogs,
  toInspect,
  toServiceContainer,
  type EngineContainer,
  type EngineInspect,
  type EngineStats,
} from './map.ts';

const FALLBACK_VERSION = 'v1.43';
const STATS_TIMEOUT_MS = 2500;
const ACTIONS = new Set(['start', 'stop', 'restart']);

interface EngineResponse {
  status: number;
  body: Buffer;
}

export function createClient(socketPath = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock') {
  let version: Promise<string> | null = null;

  function raw(method: string, path: string, timeoutMs = 10_000): Promise<EngineResponse> {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ socketPath, path, method, headers: { host: 'docker' } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error('docker request timed out')));
      req.on('error', reject);
      req.end();
    });
  }

  // Use the engine's own API version: newer engines dropped old versions, older ones reject newer.
  const prefix = () =>
    (version ??= raw('GET', '/version')
      .then((r) => `v${JSON.parse(r.body.toString()).ApiVersion}`)
      .catch(() => {
        version = null;
        return FALLBACK_VERSION;
      }));

  async function call(method: string, path: string, timeoutMs?: number): Promise<Buffer> {
    const res = await raw(method, `/${await prefix()}${path}`, timeoutMs);
    if (res.status === 404) throw new HttpError(404, 'no such container');
    if (res.status >= 400) throw new HttpError(502, `docker: ${res.body.toString().slice(0, 200)}`);
    return res.body;
  }
  const json = async <T>(path: string, timeoutMs?: number): Promise<T> =>
    JSON.parse((await call('GET', path, timeoutMs)).toString()) as T;

  return {
    async containersFor(cwd: string): Promise<ServiceContainer[]> {
      let all: EngineContainer[];
      try {
        all = await json<EngineContainer[]>('/containers/json?all=true');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; // no docker on this machine
        throw err;
      }
      const mine = all.filter((c) => belongsTo(c, cwd)).map(toServiceContainer);
      await Promise.all(
        mine
          .filter((c) => c.state === 'running')
          .map(async (c) => {
            // stream=false waits for two samples (~1s) so precpu is filled and CPU % is meaningful.
            const stats = await json<EngineStats>(`/containers/${c.id}/stats?stream=false`, STATS_TIMEOUT_MS).catch(
              () => null,
            );
            if (!stats) return;
            c.cpuPercent = cpuPercent(stats);
            c.memBytes = memBytes(stats);
          }),
      );
      return mine.sort((a, b) => a.name.localeCompare(b.name));
    },
    async logs(id: string, tail = 200) {
      return parseLogs(await call('GET', `/containers/${id}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=1`));
    },
    async inspect(id: string) {
      return toInspect(await json<EngineInspect>(`/containers/${id}/json`));
    },
    async action(id: string, action: string) {
      await call('POST', `/containers/${id}/${action}`, 60_000);
    },
  };
}

function containerId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)) throw new HttpError(400, 'invalid container id');
  return value;
}

export function create(_ctx: Context, services: Services): { module: ShubModule; service: Docker } {
  const client = createClient();

  const module: ShubModule = {
    name: 'docker',
    routes(router) {
      router.add(ROUTES.services, (req) => {
        requireRight(req.caller, 'read');
        const session = services.sessions.get(req.params.id);
        if (!session) throw new HttpError(404, 'unknown session');
        return client.containersFor(session.cwd);
      });
      router.add(ROUTES.serviceLogs, async (req) => {
        requireRight(req.caller, 'read');
        const tail = Math.min(Math.max(1, Number(req.query.get('tail')) || 200), 2000);
        return { lines: await client.logs(containerId(req.params.containerId), tail) };
      });
      router.add(ROUTES.serviceInspect, (req) => {
        requireRight(req.caller, 'read');
        return client.inspect(containerId(req.params.containerId));
      });
      router.add(ROUTES.serviceAction, async (req) => {
        requireUser(req.caller);
        const { action } = req.params;
        if (!ACTIONS.has(action)) throw new HttpError(400, 'action must be start, stop or restart');
        const id = containerId(req.params.containerId);
        await client.action(id, action);
        services.permissions.log({ actor: req.caller.id, action: `service.${action}`, detail: id.slice(0, 12) });
        return { ok: true };
      });
    },
  };
  return { module, service: { containersFor: client.containersFor } };
}
