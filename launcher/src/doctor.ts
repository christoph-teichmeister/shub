// `shub doctor`: is this machine ready for shub, and if not, what is missing.
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, join } from 'node:path';
import { service } from './service.ts';

export interface Finding {
  name: string;
  ok: boolean;
  /** Missing optional things are reported but do not fail the check. */
  optional?: boolean;
  detail: string;
}

export interface DoctorDeps {
  nodeVersion: string;
  /** Output of `tmux -V`, or null when tmux is not installed. */
  tmuxVersion(): string | null;
  which(command: string): string | null;
  exists(path: string): boolean;
  dockerSocket: string;
  port: number;
  portState(port: number): Promise<'free' | 'shub' | 'busy'>;
  /** The node binary shub's systemd unit starts, when there is one. */
  serviceNode?(): string | null;
}

const atLeast = (have: [number, number], need: [number, number]): boolean =>
  have[0] > need[0] || (have[0] === need[0] && have[1] >= need[1]);

export async function doctor(d: DoctorDeps): Promise<Finding[]> {
  const nodeOk = atLeast(d.nodeVersion.split('.').map(Number) as [number, number], [24, 0]);
  const tmux = d.tmuxVersion();
  const tmuxNum = /(\d+)\.(\d+)/.exec(tmux ?? '');
  const tmuxOk = !!tmuxNum && atLeast([Number(tmuxNum[1]), Number(tmuxNum[2])], [3, 3]);
  const claude = d.which('claude');
  const docker = d.exists(d.dockerSocket);
  const port = await d.portState(d.port);
  const unitNode = d.serviceNode?.() ?? null;
  return [
    {
      name: 'Node',
      ok: nodeOk,
      detail: nodeOk ? `Node ${d.nodeVersion}` : `Node ${d.nodeVersion} found, shub needs 24 or newer`,
    },
    {
      name: 'tmux',
      ok: tmuxOk,
      detail: tmuxOk
        ? tmux!
        : tmux
          ? `${tmux} found, shub needs 3.3 or newer`
          : 'tmux is not installed: shub needs 3.3 or newer (apt install tmux, brew install tmux)',
    },
    {
      name: 'Claude Code',
      ok: !!claude,
      detail: claude ?? 'claude is not on PATH: install Claude Code and make sure `claude` runs in a terminal',
    },
    {
      name: 'Docker',
      ok: docker,
      optional: true,
      detail: docker
        ? d.dockerSocket
        : `no Docker socket at ${d.dockerSocket} (optional: the services panel stays empty)`,
    },
    {
      name: 'Port',
      ok: port !== 'busy',
      detail:
        port === 'free'
          ? `127.0.0.1:${d.port} is free`
          : port === 'shub'
            ? `shub already answers on 127.0.0.1:${d.port}`
            : `127.0.0.1:${d.port} is used by another program: stop it or set SHUB_PORT`,
    },
    // nvm deletes the old node on an upgrade; a unit that still starts it cannot restart and cannot update.
    ...(unitNode && !d.exists(unitNode)
      ? [
          {
            name: 'Service',
            ok: false,
            detail: `shub.service starts ${unitNode}, which is gone (nvm upgrade?): npm i -g @christoph-teichmeister/shub, then shub update`,
          },
        ]
      : []),
  ];
}

function which(command: string, path = process.env.PATH ?? ''): string | null {
  for (const dir of path.split(delimiter)) {
    const file = join(dir, command);
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // next
    }
  }
  return null;
}

async function portState(port: number): Promise<'free' | 'shub' | 'busy'> {
  const free = await new Promise<boolean>((resolve) => {
    const server = createServer()
      .once('error', () => resolve(false))
      .listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
  if (free) return 'free';
  const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.json() as Promise<{ ok?: boolean }>)
    .catch(() => null);
  return health?.ok ? 'shub' : 'busy';
}

export function realDoctorDeps(env: NodeJS.ProcessEnv = process.env, port: number): DoctorDeps {
  return {
    nodeVersion: process.versions.node,
    tmuxVersion: () => {
      try {
        return execFileSync('tmux', ['-V'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return null;
      }
    },
    which: (c) => which(c, env.PATH),
    exists: existsSync,
    dockerSocket: env.DOCKER_SOCKET ?? '/var/run/docker.sock',
    port,
    portState,
    serviceNode: () => service(process.platform, env).unitNode(),
  };
}
