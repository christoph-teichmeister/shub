// install / update / rollback: download, verify, unpack next to the old version, switch `current`, restart the
// service and wait for the new version's /api/health. A version that does not come up within 30 s is rolled back.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { archiveName, changelog, compareVersions, isVersion, latest, type Channel, type Source } from './releases.ts';
import { trustedKeys, verifyArchive } from './signing.ts';
import {
  currentVersion,
  lock,
  prune,
  readState,
  switchTo,
  versionDir,
  writeState,
  type LauncherState,
} from './versions.ts';

export interface Deps {
  home: string;
  source: Source;
  /** The service of this home, if shub runs as one; null when it is started by hand. */
  service: { active(home: string): boolean; restart(): void };
  /** Resolves true once /api/health answers with `version`. */
  health(version: string, timeoutMs: number): Promise<boolean>;
  log(line: string): void;
  platform?: string;
  healthTimeoutMs?: number;
}

export type Result = NonNullable<LauncherState['last']>;

export interface Check {
  current: string | null;
  channel: Channel;
  /** Only when it is newer than current. */
  latest?: string;
  changelog?: string;
}

/** Channel to follow: the flag, else the app's setting, else the kind of version that runs now. */
export function channelFor(flag: string | undefined, configured: string | undefined, current: string | null): Channel {
  const pick = flag ?? configured;
  if (pick === 'stable' || pick === 'beta') return pick;
  if (pick !== undefined) throw new Error(`unknown channel "${pick}" (stable or beta)`);
  return current?.includes('-') ? 'beta' : 'stable';
}

export async function check(deps: Deps, channel: Channel): Promise<Check> {
  const current = currentVersion(deps.home);
  const releases = await deps.source.releases();
  const newest = latest(releases, channel);
  if (!newest || (current && compareVersions(newest.version, current) <= 0)) return { current, channel };
  return { current, channel, latest: newest.version, changelog: changelog(releases, channel, current, newest.version) };
}

async function fetchVerified(deps: Deps, version: string): Promise<void> {
  const release = (await deps.source.releases()).find((r) => r.version === version);
  if (!release) throw new Error(`there is no release ${version}`);
  const name = archiveName(version, deps.platform);
  const urls = [name, 'SHA256SUMS', 'SHA256SUMS.sig'].map((n) => {
    const url = release.assets.get(n);
    if (!url) throw new Error(`release ${version} has no ${n}${n === name ? ' (no build for this platform)' : ''}`);
    return url;
  });
  const dir = join(deps.home, 'downloads', `${version}.${process.pid}`);
  const partial = join(deps.home, 'versions', `.${version}.${process.pid}.partial`);
  mkdirSync(dir, { recursive: true });
  try {
    const [archive, sums, sig] = [name, 'SHA256SUMS', 'SHA256SUMS.sig'].map((n) => join(dir, n));
    deps.log(`Downloading ${name}`);
    await deps.source.download(urls[0], archive);
    await deps.source.download(urls[1], sums);
    await deps.source.download(urls[2], sig);
    const current = currentVersion(deps.home);
    const keys = (await deps.source.testKeys()) ?? trustedKeys(current ? versionDir(deps.home, current) : null);
    await verifyArchive({ archive, name, sums: readFileSync(sums), signature: readFileSync(sig, 'utf8'), keys });
    deps.log('Signature and checksum verified');
    mkdirSync(partial, { recursive: true });
    execFileSync('tar', ['-xzf', archive, '-C', partial, '--no-same-owner'], { stdio: 'ignore' });
    if (!existsSync(join(partial, 'server', 'main.ts'))) throw new Error(`${name} has no server/main.ts`);
    renameSync(partial, versionDir(deps.home, version));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(partial, { recursive: true, force: true });
  }
}

function record(deps: Deps, last: Result, patch: Partial<LauncherState> = {}): Result {
  writeState(deps.home, { ...patch, last });
  deps.log(last.message);
  return last;
}

/** Switch to `to`, restart and health-check it when shub runs as a service; switch back if it does not come up. */
async function activate(deps: Deps, to: string, verb: string): Promise<Result> {
  const from = currentVersion(deps.home);
  const before = readState(deps.home).previous;
  const at = new Date().toISOString();
  switchTo(deps.home, to);
  writeState(deps.home, { previous: from ?? undefined });
  if (!deps.service.active(deps.home)) {
    const message = from ? `${verb} ${to}. Restart shub to use it.` : `Installed ${to}.`;
    return record(deps, { at, from, to, ok: true, message });
  }
  deps.log(`Restarting shub with ${to}`);
  deps.service.restart();
  const timeout = deps.healthTimeoutMs ?? 30_000;
  if (await deps.health(to, timeout)) return record(deps, { at, from, to, ok: true, message: `${verb} ${to}.` });
  const seconds = Math.round(timeout / 1000);
  if (!from) return record(deps, { at, from, to, ok: false, message: `${to} did not answer within ${seconds} s.` });
  switchTo(deps.home, from);
  deps.service.restart();
  return record(
    deps,
    {
      at,
      from,
      to,
      ok: false,
      message: `${to} did not answer /api/health within ${seconds} s; rolled back to ${from}.`,
    },
    { previous: before },
  );
}

/** Install `to` (or the newest release on the channel) and switch to it. */
export async function update(deps: Deps, opts: { to?: string; channel: Channel }): Promise<Result | null> {
  if (opts.to !== undefined && !isVersion(opts.to)) throw new Error(`not a version: ${opts.to}`);
  const unlock = lock(deps.home);
  try {
    const current = currentVersion(deps.home);
    const target = opts.to ?? (await check(deps, opts.channel)).latest;
    if (!target || target === current) {
      deps.log(`shub ${current} is up to date (${opts.channel}).`);
      return null;
    }
    if (!existsSync(versionDir(deps.home, target))) await fetchVerified(deps, target);
    const result = await activate(
      deps,
      target,
      compareVersions(target, current ?? target) < 0 ? 'Switched to' : 'Updated to',
    );
    for (const v of prune(deps.home)) deps.log(`Removed old version ${v}`);
    return result;
  } finally {
    unlock();
  }
}

export async function rollback(deps: Deps): Promise<Result> {
  const unlock = lock(deps.home);
  try {
    const previous = readState(deps.home).previous;
    if (!previous || !existsSync(versionDir(deps.home, previous)))
      throw new Error('there is no previous version to roll back to');
    return await activate(deps, previous, 'Rolled back to');
  } finally {
    unlock();
  }
}

/** Polls http://127.0.0.1:<port>/api/health until it reports `version`. */
export function healthCheck(port: number): Deps['health'] {
  return async (version, timeoutMs) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
        if (res.ok && ((await res.json()) as { version?: string }).version === version) return true;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };
}
