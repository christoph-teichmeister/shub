// Updates for shub installed with the launcher (launcher/). The launcher does the real work: download, signature
// check, version switch, service restart and the automatic rollback. This module asks it every hour whether a
// newer release exists (cached in sqlite), shows the launcher's last result and starts an install when the user
// clicks, or right after the check in mode "auto". Started from a git checkout (no SHUB_LAUNCHER in the environment) everything here is read-only.
import { execFile, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ROUTES, type UpdateChannel, type UpdateMode, type UpdateStatus } from '../../shared/api.ts';
import { appVersion } from '../api/index.ts';
import { HttpError, requireUser, type Caller } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services } from '../services.ts';

const HOUR = 60 * 60 * 1000;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const run = promisify(execFile);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS update_check (
    id INTEGER PRIMARY KEY CHECK (id = 1), checked_at TEXT NOT NULL, current TEXT NOT NULL, channel TEXT NOT NULL,
    latest TEXT, changelog TEXT, error TEXT)`,
];

interface CheckRow {
  checked_at: string;
  latest: string | null;
  changelog: string | null;
  error: string | null;
}

/** Installing code is for the person at the browser only, not the token file (see docs/SECURITY.md). */
function requireBrowserUser(caller: Caller): void {
  if (caller.kind !== 'user') throw new HttpError(403, 'only you can change updates, in the browser');
}

export function create(ctx: Context, services: Services, env: NodeJS.ProcessEnv = process.env): { module: ShubModule } {
  const launcher = env.SHUB_LAUNCHER || null;
  const home = env.SHUB_HOME ?? join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'shub');
  const current = appVersion(ctx.paths.appDir);
  let migrated = false;
  const db = () => {
    if (!migrated) services.state.migrate('updates', SCHEMA);
    migrated = true;
    return services.state.db;
  };

  const channel = (): UpdateChannel =>
    services.config.get().updateChannel ?? (current.includes('-') ? 'beta' : 'stable');

  const mode = (): UpdateMode => services.config.get().updateMode ?? 'ask';

  /** The check result for the running version and the current channel; older ones are stale. */
  const cached = (): CheckRow | undefined =>
    db().prepare('SELECT * FROM update_check WHERE id = 1 AND current = ? AND channel = ?').get(current, channel()) as
      CheckRow | undefined;

  /** <SHUB_HOME>/launcher.json, written by the launcher. */
  const launcherState = (): Pick<UpdateStatus, 'previous' | 'last'> => {
    try {
      const { previous, last } = JSON.parse(readFileSync(join(home, 'launcher.json'), 'utf8'));
      return { previous, last };
    } catch {
      return {};
    }
  };

  function status(): UpdateStatus {
    if (!launcher) return { current, channel: channel(), mode: mode(), managedBy: 'git', checkedAt: null };
    const row = cached();
    return {
      current,
      channel: channel(),
      mode: mode(),
      managedBy: 'launcher',
      checkedAt: row?.checked_at ?? null,
      ...(row?.latest && { latest: row.latest, changelog: row.changelog ?? '' }),
      ...(row?.error && { checkError: row.error }),
      ...launcherState(),
    };
  }

  const managed = (): string => {
    if (!launcher) throw new HttpError(409, 'shub runs from a git checkout; updates are managed by git');
    return launcher;
  };

  let checking: Promise<UpdateStatus> | null = null;
  async function runCheck(script: string): Promise<UpdateStatus> {
    const ch = channel();
    let result: { latest?: string; changelog?: string } = {};
    let error: string | null = null;
    try {
      const args = [script, 'update', '--check', '--json', '--channel', ch];
      result = JSON.parse((await run(process.execPath, args, { env, timeout: 60_000 })).stdout);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr?.trim();
      error = (stderr || (err as Error).message)
        .split('\n')
        .at(-1)!
        .replace(/^shub: /, '');
    }
    db()
      .prepare('INSERT OR REPLACE INTO update_check VALUES (1, ?, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), current, ch, result.latest ?? null, result.changelog ?? null, error);
    ctx.bus.emit({ type: 'updates.changed' });
    const { latest, last } = status();
    // A version the launcher already rolled back is not tried again by itself; the user can still click.
    if (mode() === 'auto' && latest && !(last && !last.ok && last.to === latest)) {
      launch(['update', '--to', latest]);
      services.permissions.log({ actor: 'shub', action: 'updates.install', detail: `${latest} (auto)` });
    }
    return status();
  }
  const check = (): Promise<UpdateStatus> => (checking ??= runCheck(managed()).finally(() => (checking = null)));

  /** Runs the launcher on its own: it outlives this process when it restarts the service. */
  function launch(args: string[]): void {
    const script = managed();
    mkdirSync(home, { recursive: true });
    const log = openSync(join(home, 'update.log'), 'a');
    const child = spawn(process.execPath, [script, ...args], { detached: true, stdio: ['ignore', log, log], env });
    child.on('error', (err) => console.error('shub: could not start the launcher', err));
    child.unref();
    closeSync(log);
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    module: {
      name: 'updates',
      routes(router) {
        router.add(ROUTES.updates, (req) => {
          requireUser(req.caller);
          return status();
        });
        router.add(ROUTES.updateCheck, (req) => {
          requireBrowserUser(req.caller);
          return check();
        });
        router.add(ROUTES.updateInstall, async (req) => {
          requireBrowserUser(req.caller);
          managed();
          const { version = status().latest } = await req.json<{ version?: string }>();
          if (!version || !VERSION.test(version)) throw new HttpError(400, 'version must be a release version');
          launch(['update', '--to', version]);
          services.permissions.log({ actor: req.caller.id, action: 'updates.install', detail: version });
          return { ok: true, version };
        });
        router.add(ROUTES.updateRollback, (req) => {
          requireBrowserUser(req.caller);
          managed();
          const { previous } = launcherState();
          if (!previous) throw new HttpError(409, 'there is no previous version to roll back to');
          launch(['rollback']);
          services.permissions.log({ actor: req.caller.id, action: 'updates.rollback', detail: previous });
          return { ok: true, version: previous };
        });
        router.add(ROUTES.updateChannel, async (req) => {
          requireBrowserUser(req.caller);
          managed();
          const { channel: next } = await req.json<{ channel?: string }>();
          if (next !== 'stable' && next !== 'beta') throw new HttpError(400, 'channel must be stable or beta');
          services.config.update((c) => (c.updateChannel = next), req.caller.id);
          void check();
          return status();
        });
        router.add(ROUTES.updateMode, async (req) => {
          requireBrowserUser(req.caller);
          managed();
          const { mode: next } = await req.json<{ mode?: string }>();
          if (next !== 'auto' && next !== 'ask') throw new HttpError(400, 'mode must be auto or ask');
          services.config.update((c) => (c.updateMode = next), req.caller.id);
          if (next === 'auto') void check();
          return status();
        });
      },
      start() {
        if (!launcher) return;
        const row = cached();
        if (!row || Date.parse(row.checked_at) < Date.now() - HOUR) void check();
        timer = setInterval(() => void check(), HOUR);
        timer.unref();
      },
      stop() {
        clearInterval(timer);
      },
    },
  };
}
