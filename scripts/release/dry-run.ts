// Dry release run: pack this platform's archive, sign it with a throwaway key, serve it as a local "release",
// install the packed launcher into a temp npm prefix, `shub install` into a temp SHUB_HOME and start it on a free
// port with temp config/state dirs and its own tmux socket (shub-dry-<pid>); check /api/health. Then publish a
// second version, update to it from the web API (as the browser user), restart, and roll back with the CLI.
// Never touches ~/.local/share/shub, ~/.config/shub, systemd, the default tmux server or GitHub.
//   npm run build && node scripts/release/dry-run.ts [--archive <shub-<version>-<platform>.tar.gz>]
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { archiveName } from '../../launcher/src/releases.ts';
import { pack, signDir } from './release.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const { values } = parseArgs({ options: { archive: { type: 'string' } } });

const root = mkdtempSync(join(tmpdir(), 'shub-dry-'));
const socket = `shub-dry-${process.pid}`;
const say = (line: string) => console.log(`dry-run: ${line}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise((r) => s.close(r));
  return port;
}

async function waitFor<T>(what: string, check: () => Promise<T | null | undefined>, ms = 30_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

/** The same archive under another version: unpack, set package.json's version, pack again. */
function rebrand(archive: string, version: string, outDir: string): void {
  const dir = mkdtempSync(join(root, 'rebrand-'));
  execFileSync('tar', ['-xzf', archive, '-C', dir]);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...pkg, version }, null, 2) + '\n');
  mkdirSync(outDir, { recursive: true });
  execFileSync('tar', ['-czf', join(outDir, archiveName(version)), '-C', dir, '.'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  rmSync(dir, { recursive: true });
}

function cleanup(): void {
  try {
    execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
  } catch {
    // never started
  }
  rmSync(join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${process.getuid?.() ?? 0}`, socket), { force: true });
  rmSync(root, { recursive: true, force: true });
}

let app: ChildProcess | null = null;
try {
  // 1. The "release": archive, SHA256SUMS signed with a throwaway key, releases.json in the GitHub API shape.
  const release = join(root, 'release');
  const version =
    /^shub-(.+)-[a-z0-9]+-[a-z0-9]+\.tar\.gz$/.exec(basename(values.archive ?? ''))?.[1] ??
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const [major, minor, micro] = version.split('-')[0].split('.').map(Number);
  const next = `${major}.${minor}.${micro + 1}`;
  const first = join(release, version);
  mkdirSync(first, { recursive: true });
  const archive = values.archive ? join(first, basename(values.archive)) : pack(version, first);
  if (values.archive) copyFileSync(values.archive, archive);
  rebrand(archive, next, join(release, next));

  const key = generateKeyPairSync('ed25519');
  const publicPem = key.publicKey.export({ type: 'spki', format: 'pem' }).toString().trim();
  const privatePem = key.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  writeFileSync(join(release, 'release-keys.pem'), publicPem + '\n');
  const url = pathToFileURL(release).href + '/';
  const entries: unknown[] = [];
  async function publish(v: string): Promise<void> {
    await signDir(join(release, v), privatePem, [publicPem]);
    const assets = [archiveName(v), 'SHA256SUMS', 'SHA256SUMS.sig'].map((name) => ({
      name,
      browser_download_url: `${url}${v}/${name}`,
    }));
    entries.unshift({ tag_name: `v${v}`, draft: false, prerelease: v.includes('-'), body: `Dry run ${v}.`, assets });
    writeFileSync(join(release, 'releases.json'), JSON.stringify(entries));
    say(`published ${v}: ${assets.map((a) => a.name).join(', ')}`);
  }
  await publish(version);

  // 2. The launcher as npm would install it: npm pack (builds dist/) and a global install into a temp prefix.
  const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', root], {
    cwd: join(ROOT, 'launcher'),
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .at(-1)!;
  const prefix = join(root, 'npm');
  execFileSync('npm', ['install', '-g', '--prefix', prefix, '--offline', '--no-audit', '--no-fund', join(root, tgz)], {
    stdio: 'ignore',
  });
  const shubBin = join(prefix, 'bin', 'shub');
  say(`launcher ${tgz} installed at ${shubBin}`);

  // 3. Install and start with everything in temp dirs.
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  // A fake claude, like test/e2e.test.ts: the global Claude session must not start the real one.
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'claude'), '#!/bin/sh\nexec sleep 600\n', { mode: 0o755 });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SHUB_HOME: join(root, 'home'),
    SHUB_TEST_RELEASES: url,
    SHUB_CONFIG_DIR: join(root, 'config'),
    SHUB_STATE_DIR: join(root, 'state'),
    XDG_CONFIG_HOME: join(root, 'xdg-config'),
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    DOCKER_SOCKET: join(root, 'no-docker.sock'),
    SHUB_PORT: String(port),
    SHUB_URL: base,
    SHUB_TMUX_SOCKET: socket,
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
  };
  for (const k of ['SHUB_PUBLIC_URL', 'SHUB_TOKEN', 'SHUB_LAUNCHER', 'TMUX', 'TMUX_PANE']) delete env[k];
  const shub = (...args: string[]) => {
    const out = execFileSync(shubBin, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    for (const line of out.split('\n')) say(`$ shub ${args.join(' ')}: ${line}`);
  };
  try {
    shub('doctor');
  } catch (err) {
    say(`doctor reported missing things (fine for a dry run):\n${(err as { stdout?: string }).stdout ?? err}`);
  }
  shub('install', '--channel', version.includes('-') ? 'beta' : 'stable');
  shub('--version');

  let log = '';
  async function start(expected: string): Promise<void> {
    log = '';
    app = spawn(shubBin, ['start'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    app.stdout!.on('data', (d) => (log += d));
    app.stderr!.on('data', (d) => (log += d));
    const health = await waitFor('/api/health', async () => {
      if (app?.exitCode !== null) throw new Error(`shub exited\n--- shub output ---\n${log}`);
      const res = await fetch(`${base}/api/health`);
      return res.ok ? ((await res.json()) as { version: string }) : null;
    }).catch((err: Error) => {
      throw new Error(`${err.message}\n--- shub output ---\n${log}`);
    });
    say(`GET /api/health -> ${JSON.stringify(health)}`);
    if (health.version !== expected) throw new Error(`expected ${expected}, got ${health.version}`);
  }
  async function stop(): Promise<void> {
    const exited = new Promise((r) => app!.once('exit', r));
    app!.kill('SIGTERM');
    await exited;
    say(`stopped pid ${app!.pid}`);
    app = null;
  }

  await start(version);
  shub('status');

  // 4. A newer release appears; the browser user installs it from Settings (the same API calls).
  await publish(next);
  const token = readFileSync(join(root, 'state', 'token'), 'utf8').trim();
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ token, deviceName: 'dry-run' }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
    return data as { latest?: string; managedBy?: string; last?: { message: string }; previous?: string };
  };
  const checked = await call('POST', '/api/updates/check');
  say(`POST /api/updates/check -> managedBy ${checked.managedBy}, latest ${checked.latest}`);
  if (checked.latest !== next) throw new Error(`expected latest ${next}`);
  say(`POST /api/updates/install -> ${JSON.stringify(await call('POST', '/api/updates/install', { version: next }))}`);
  const after = await waitFor('the launcher to finish', async () => {
    const s = await call('GET', '/api/updates');
    return s.last?.message.includes(next) ? s : null;
  });
  say(`GET /api/updates -> last: "${after.last!.message}", previous ${after.previous}`);
  say(`launcher log:\n${readFileSync(join(root, 'home', 'update.log'), 'utf8').trim()}`);

  // Not a service here, so the launcher asks for a restart.
  await stop();
  await start(next);
  await stop();
  shub('rollback');
  await start(version);
  await stop();
  say('ok');
} catch (err) {
  console.error(`dry-run: FAILED: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  (app as ChildProcess | null)?.kill('SIGTERM');
  cleanup();
}
