import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

const run = promisify(execFile);
const cli = new URL('./shub.ts', import.meta.url).pathname;
const pkgVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('--version and --help', async () => {
  assert.equal((await run('node', [cli, '--version'])).stdout.trim(), pkgVersion);
  const help = (await run('node', [cli, '--help'])).stdout;
  assert.equal(help.split('\n')[0], 'shub — your session hub');
  for (const name of ['status', 'project', 'session', 'open']) assert.match(help, new RegExp(`^  ${name} `, 'm'));
});

test('status talks to SHUB_URL with SHUB_TOKEN; unknown commands fail clearly', async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.url} ${req.headers.authorization}`);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true, version: '2026.10.0', apiVersion: 1 }));
    res.end(JSON.stringify([{ status: 'working' }, { status: 'working' }, { status: 'needs-you' }]));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const env = {
    ...process.env,
    SHUB_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    SHUB_TOKEN: 'tok',
  };
  const { stdout } = await run('node', [cli, 'status'], { env });
  assert.match(stdout, /shub 2026\.10\.0 at .* \(API v1\)\n3 sessions: 2 working, 1 needs-you/);
  assert.deepEqual(seen, ['/api/health Bearer tok', '/api/sessions Bearer tok']);
  const json = JSON.parse((await run('node', [cli, 'status', '--json'], { env })).stdout);
  assert.equal(json.sessions.working, 2);
  server.close();
  await assert.rejects(run('node', [cli, 'nope'], { env }), /unknown command "nope"/);
});
