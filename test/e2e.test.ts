// End to end: the real server/main.ts as a child process, with temp config/state dirs, its own tmux socket
// (shub-e2e-<pid>) and a fake `claude` on PATH. Never touches the default tmux server, ~/.claude or Docker.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import type { ProjectView, Session } from '../shared/api.ts';

const appDir = new URL('..', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'shub-e2e-'));
const dirs = {
  config: join(root, 'config'),
  state: join(root, 'state'),
  bin: join(root, 'bin'),
  out: join(root, 'out'),
  project: join(root, 'project'),
  claude: join(root, 'claude-home'),
};
const socket = `shub-e2e-${process.pid}`;
let server: ChildProcess;
let base = '';
let cookie = '';
let log = '';

// Fake claude: records its argv and the session token, then idles as a plain interactive shell.
const FAKE_CLAUDE = `#!/bin/bash
echo "$*" > "$SHUB_E2E_OUT/$SHUB_SESSION_ID.args"
printf '%s' "$SHUB_TOKEN" > "$SHUB_E2E_OUT/$SHUB_SESSION_ID.token"
exec bash --norc --noprofile -i
`;

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise((r) => s.close(r));
  return port;
}

async function waitFor<T>(check: () => T | Promise<T>, what: string, ms = 10_000): Promise<NonNullable<T>> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await Promise.resolve(check()).catch(() => undefined);
    if (value) return value as NonNullable<T>;
    if (Date.now() > until) assert.fail(`timed out waiting for ${what}\n--- server output ---\n${log}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(base + path, {
    method,
    headers: {
      // Bearer requests (hooks) go without the browser cookie.
      ...(cookie && !headers.authorization && { cookie, origin: base }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await api(method, path, body, headers);
  assert.ok(res.ok, `${method} ${path}: ${res.status} ${await res.clone().text()}`);
  return (await res.json()) as T;
}

const session = async (id: string) => (await json<Session[]>('GET', '/api/sessions')).find((s) => s.id === id);
const tmuxHas = (name: string): boolean => {
  try {
    execFileSync('tmux', ['-L', socket, 'has-session', '-t', `=${name}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

before(async () => {
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dirs.bin, 'claude'), FAKE_CLAUDE);
  chmodSync(join(dirs.bin, 'claude'), 0o755);
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SHUB_CONFIG_DIR: dirs.config,
    SHUB_STATE_DIR: dirs.state,
    SHUB_PORT: String(port),
    SHUB_TMUX_SOCKET: socket,
    SHUB_E2E_OUT: dirs.out,
    CLAUDE_CONFIG_DIR: dirs.claude,
    DOCKER_SOCKET: join(root, 'no-docker.sock'),
    PATH: `${dirs.bin}:${process.env.PATH}`,
  };
  for (const key of ['SHUB_PUBLIC_URL', 'TMUX', 'TMUX_PANE']) delete env[key];
  server = spawn(process.execPath, [join(appDir, 'server', 'main.ts')], { cwd: appDir, env, stdio: 'pipe' });
  server.stdout!.on('data', (d) => (log += d));
  server.stderr!.on('data', (d) => (log += d));
  await waitFor(() => fetch(`${base}/api/health`).then((r) => r.ok), 'server health');
});

after(async () => {
  if (server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill('SIGTERM');
    await exited;
  }
  // Only this test's tmux server; kill-server leaves the socket file behind.
  try {
    execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
  } catch {
    // not running
  }
  const uid = process.getuid?.() ?? 0;
  rmSync(join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${uid}`, socket), { force: true });
  rmSync(root, { recursive: true, force: true });
});

test('health, login, project, session, terminal, hooks, close', { timeout: 60_000 }, async () => {
  const health = await json<{ ok: boolean; apiVersion: number }>('GET', '/api/health');
  assert.equal(health.ok, true);
  assert.equal((await api('GET', '/api/sessions')).status, 401, 'login required');

  // Login with the token file the server created.
  const token = readFileSync(join(dirs.state, 'token'), 'utf8').trim();
  assert.equal((await api('POST', '/api/auth/login', { token: 'wrong' })).status, 401);
  const login = await api('POST', '/api/auth/login', { token, deviceName: 'e2e' });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie')!.split(';')[0];
  const me = await json<{ caller: { kind: string; deviceId?: string } }>('GET', '/api/auth/me');
  assert.equal(me.caller.kind, 'user');
  assert.ok(me.caller.deviceId);

  const project = await json<ProjectView>('POST', '/api/projects', { name: 'E2E', path: dirs.project });
  assert.equal(project.path, dirs.project);
  assert.deepEqual(await json('GET', `/api/projects/${project.id}/worktrees`), [], 'not a git repo');

  const started = await json<Session>('POST', '/api/sessions', { kind: 'claude', projectId: project.id });
  assert.equal(started.status, 'new');
  assert.ok(tmuxHas(`shub-${started.id}`));
  const tokenFile = join(dirs.out, `${started.id}.token`);
  const sessionToken = await waitFor(() => existsSync(tokenFile) && readFileSync(tokenFile, 'utf8'), 'fake claude');
  const args = readFileSync(join(dirs.out, `${started.id}.args`), 'utf8');
  assert.match(args, new RegExp(`--session-id ${started.claudeSessionId} --settings \\S+ --permission-mode default`));
  const settings = JSON.parse(readFileSync(join(dirs.state, 'sessions', started.id, 'settings.json'), 'utf8'));
  assert.ok(settings.permissions.deny.includes(`Read(/${dirs.state}/token)`));

  // Terminal WebSocket: what we type comes back through tmux.
  const ws = new WebSocket(`${base.replace('http', 'ws')}/api/terminals/${started.id}?cols=100&rows=30`, {
    headers: { cookie, origin: base },
  });
  let seen = '';
  ws.on('message', (d) => (seen += d.toString()));
  await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject));
  await waitFor(() => seen.includes('\u001b['), 'tmux screen');
  ws.send('echo e2e$((40+2))\r');
  await waitFor(() => seen.includes('e2e42'), 'echo over the terminal');
  ws.close();

  // Hooks with the session's own token move the status.
  const bearer = { authorization: `Bearer ${sessionToken}` };
  await json('POST', '/api/hooks/UserPromptSubmit', { prompt: 'hi' }, bearer);
  assert.equal((await session(started.id))?.status, 'working');
  await json('POST', '/api/hooks/Stop', { stop_hook_active: false }, bearer);
  const cleared = '7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
  await json('POST', '/api/hooks/SessionStart', { source: 'clear', session_id: cleared }, bearer);
  assert.equal((await api('POST', '/api/hooks/Stop', {}, { authorization: 'Bearer nope' })).status, 401);
  const after = await session(started.id);
  assert.equal(after?.status, 'your-turn');
  assert.equal(after?.claudeSessionId, cleared, '/clear moved the Claude session id');

  // Close: a session may not close another one, only itself; you close any.
  const other = await json<Session>('POST', '/api/sessions', { kind: 'claude', projectId: project.id });
  assert.equal((await api('DELETE', `/api/sessions/${other.id}`, undefined, bearer)).status, 403);
  await json('DELETE', `/api/sessions/${other.id}`);
  assert.equal(await session(other.id), undefined);
  // Closing itself: tmux session gone, token revoked.
  await json('DELETE', `/api/sessions/${started.id}`, undefined, bearer);
  assert.equal(await session(started.id), undefined);
  assert.ok(!tmuxHas(`shub-${started.id}`));
  assert.equal((await api('POST', '/api/hooks/Stop', {}, bearer)).status, 401, 'session token revoked');
});
