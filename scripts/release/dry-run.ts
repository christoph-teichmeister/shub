// Dry release run: pack this platform's archive, sign it with a throwaway key, serve it as a local "release",
// install the packed launcher into a temp npm prefix, `shub install` into a temp SHUB_HOME and start it on a free
// port with temp config/state dirs and its own tmux socket (shub-dry-<pid>); check /api/health, stop, clean up.
// Never touches ~/.local/share/shub, ~/.config/shub, systemd, the default tmux server or GitHub.
//   npm run build && node scripts/release/dry-run.ts [--archive <shub-<version>-<platform>.tar.gz>]
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { pack, signDir } from './release.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const { values } = parseArgs({ options: { archive: { type: 'string' } } });

const root = mkdtempSync(join(tmpdir(), 'shub-dry-'));
const socket = `shub-dry-${process.pid}`;
const say = (line: string) => console.log(`dry-run: ${line}`);

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise((r) => s.close(r));
  return port;
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

try {
  // 1. The "release": archive, SHA256SUMS signed with a throwaway key, releases.json in the GitHub API shape.
  const release = join(root, 'release');
  const version =
    /^shub-(.+)-[a-z0-9]+-[a-z0-9]+\.tar\.gz$/.exec(basename(values.archive ?? ''))?.[1] ??
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const dir = join(release, version);
  mkdirSync(dir, { recursive: true });
  if (values.archive) copyFileSync(values.archive, join(dir, basename(values.archive)));
  else pack(version, dir);
  const key = generateKeyPairSync('ed25519');
  const publicPem = key.publicKey.export({ type: 'spki', format: 'pem' }).toString().trim();
  writeFileSync(join(release, 'release-keys.pem'), publicPem + '\n');
  await signDir(dir, key.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), [publicPem]);
  const url = pathToFileURL(release).href + '/';
  const assets = readdirSync(dir).map((name) => ({ name, browser_download_url: `${url}${version}/${name}` }));
  writeFileSync(
    join(release, 'releases.json'),
    JSON.stringify([
      { tag_name: `v${version}`, draft: false, prerelease: version.includes('-'), body: 'Dry run.', assets },
    ]),
  );
  say(`release ${version}: ${assets.map((a) => a.name).join(', ')}`);

  // 2. The launcher as npm would install it: npm pack (builds dist/) and a global install into a temp prefix.
  const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', root], {
    cwd: join(ROOT, 'launcher'),
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .at(-1)!;
  const prefix = join(root, 'npm');
  execFileSync(
    'npm',
    ['install', '--global', '--prefix', prefix, '--offline', '--no-audit', '--no-fund', join(root, tgz)],
    {
      stdio: 'ignore',
    },
  );
  const shubBin = join(prefix, 'bin', 'shub');
  say(`launcher ${tgz} installed at ${shubBin}`);

  // 3. Install and start with everything in temp dirs.
  const port = await freePort();
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
    SHUB_URL: `http://127.0.0.1:${port}`,
    SHUB_TMUX_SOCKET: socket,
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
  };
  for (const k of ['SHUB_PUBLIC_URL', 'SHUB_TOKEN', 'TMUX', 'TMUX_PANE']) delete env[k];
  const shub = (...args: string[]) => {
    const out = execFileSync(shubBin, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    for (const line of out.split('\n')) say(`$ shub ${args.join(' ')}: ${line}`);
  };
  try {
    shub('doctor');
  } catch (err) {
    say(`doctor reported missing things (fine for a dry run):\n${(err as { stdout?: string }).stdout ?? err}`);
  }
  shub('install');
  shub('--version');

  let log = '';
  const app = spawn(shubBin, ['start'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout!.on('data', (d) => (log += d));
  app.stderr!.on('data', (d) => (log += d));
  const until = Date.now() + 30_000;
  let health: unknown = null;
  while (!health && Date.now() < until && app.exitCode === null) {
    health = await fetch(`http://127.0.0.1:${port}/api/health`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!health) await new Promise((r) => setTimeout(r, 200));
  }
  if (!health) throw new Error(`shub did not answer /api/health within 30 s\n--- shub output ---\n${log}`);
  say(`GET /api/health -> ${JSON.stringify(health)}`);
  shub('status');

  const exited = new Promise((r) => app.once('exit', r));
  app.kill('SIGTERM');
  await exited;
  say(`stopped (pid ${app.pid}); shub output:\n${log.trim()}`);
  say('ok');
} catch (err) {
  console.error(`dry-run: FAILED: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
