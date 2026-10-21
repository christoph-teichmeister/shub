// Updates for shub installed with the launcher (launcher/). The launcher does the real work: download, signature
// check, version switch, service restart and the automatic rollback. This module asks it whether a newer release
// exists (cached in sqlite) as soon as the release workflow posts to the ntfy topic below, and every 6 hours as backup, shows the launcher's last result and starts an install when the user
// clicks, or right after the check in mode "auto". Started from a git checkout (no SHUB_LAUNCHER in the environment) everything here is read-only.
import { execFile, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { ROUTES, type ReleaseNotes, type UpdateChannel, type UpdateMode, type UpdateStatus } from '../../shared/api.ts';
import { appVersion } from '../api/index.ts';
import { HttpError, requireUser, type Caller } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services } from '../services.ts';

const EVERY = 6 * 60 * 60 * 1000;
/** The release workflow posts each new version here. Anyone can post, so a message only starts checks (at most
 * one a minute); what gets installed still comes from GitHub and must pass the signature check. */
const FEED = 'https://ntfy.sh/christoph-teichmeister-shub-releases/json';
const MIN_GAP = 60_000;
/** Checks after a release message: GitHub lists a new release a moment after the workflow announces it. */
const CHASE = 4;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const run = promisify(execFile);
// ponytail: first page only, plenty for reading back; page through when someone wants older notes.
const RELEASES = 'https://api.github.com/repos/christoph-teichmeister/shub/releases?per_page=50';

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

  const gap = Number(env.SHUB_UPDATE_GAP_MS) || MIN_GAP;
  /** Checks now unless a check ran in the last minute. */
  const nudge = (): void => {
    const row = cached();
    if (mode() !== 'off' && !(row && Date.parse(row.checked_at) > Date.now() - gap)) void check();
  };

  /** Checks a minute apart until GitHub lists something newer: a check right after the release message can still
   * see the old list. One chase at a time, so a flood of messages stays at one check a minute. */
  let chasing = false;
  async function chase(version: string, signal: AbortSignal): Promise<void> {
    if (chasing || version === current) return;
    chasing = true;
    try {
      for (let i = 0; i < CHASE && !signal.aborted && mode() !== 'off'; i++) {
        const row = cached();
        const wait = row ? Date.parse(row.checked_at) + gap - Date.now() : 0;
        if (wait > 0) await sleep(wait, undefined, { signal }).catch(() => {});
        if (signal.aborted || (await check()).latest) return;
      }
    } finally {
      chasing = false;
    }
  }

  /** Keeps a stream to the ntfy topic open; a connect (it may have missed one) nudges a check, a message chases it. */
  async function listen(url: string, signal: AbortSignal): Promise<void> {
    let delay = 5_000;
    while (!signal.aborted) {
      // ntfy sends a keepalive every 45 s; silence for 2 minutes means the connection is dead.
      const idle = new AbortController();
      const timeout = setTimeout(() => idle.abort(), 120_000);
      try {
        const res = await fetch(url, { signal: AbortSignal.any([signal, idle.signal]) });
        if (!res.ok || !res.body) throw new Error(`ntfy answered ${res.status}`);
        let buf = '';
        for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
          timeout.refresh();
          const lines = (buf + chunk).split('\n');
          buf = lines.pop()!;
          for (const line of lines) {
            const { event, message = '' } = JSON.parse(line || '{}') as { event?: string; message?: string };
            if (event === 'open') delay = 5_000;
            if (event === 'message' && VERSION.test(message)) void chase(message, signal);
            else if (event === 'open' || event === 'message') nudge();
          }
        }
      } catch {
        // offline or ntfy down: the backup check still runs, try again later
      } finally {
        clearTimeout(timeout);
      }
      await sleep(delay, undefined, { signal }).catch(() => {});
      delay = Math.min(delay * 2, 10 * 60_000);
    }
  }

  /** Notes of the running version and the ones before it on the channel, from GitHub (newest first). */
  async function releaseNotes(): Promise<ReleaseNotes[]> {
    const res = await fetch(RELEASES, { headers: { accept: 'application/vnd.github+json' } }).catch(() => null);
    if (!res?.ok)
      throw new HttpError(502, `could not load the release notes from GitHub${res ? ` (${res.status})` : ''}`);
    const list = (await res.json()) as {
      tag_name: string;
      draft: boolean;
      prerelease: boolean;
      published_at: string;
      body: string | null;
    }[];
    const releases = list.filter((r) => !r.draft && (channel() === 'beta' || !r.prerelease));
    // Newer releases than the running one belong to "is available"; a version GitHub does not know shows them all.
    const at = releases.findIndex((r) => r.tag_name === `v${current}`);
    return releases
      .slice(Math.max(at, 0))
      .map((r) => ({ version: r.tag_name.replace(/^v/, ''), publishedAt: r.published_at, notes: r.body ?? '' }));
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  const feed = new AbortController();
  return {
    module: {
      name: 'updates',
      routes(router) {
        router.add(ROUTES.updates, (req) => {
          requireUser(req.caller);
          return status();
        });
        router.add(ROUTES.changelog, (req) => {
          requireUser(req.caller);
          return releaseNotes();
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
          if (next !== 'auto' && next !== 'ask' && next !== 'off')
            throw new HttpError(400, 'mode must be auto, ask or off');
          services.config.update((c) => (c.updateMode = next), req.caller.id);
          if (next === 'auto') void check();
          return status();
        });
      },
      start() {
        if (!launcher) return;
        const row = cached();
        if (mode() !== 'off' && (!row || Date.parse(row.checked_at) < Date.now() - EVERY)) void check();
        timer = setInterval(() => mode() !== 'off' && void check(), EVERY);
        timer.unref();
        const url = env.SHUB_RELEASE_FEED ?? FEED;
        if (url) void listen(url, feed.signal);
      },
      stop() {
        clearInterval(timer);
        feed.abort();
      },
    },
  };
}
