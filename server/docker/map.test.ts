import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  belongsTo,
  cpuPercent,
  demux,
  kindOf,
  maskEnv,
  MASK,
  memBytes,
  parseLogs,
  toInspect,
  toServiceContainer,
  type EngineContainer,
} from './map.ts';

// Shape taken from a real /containers/json response (Docker 26.1, API 1.45).
const backend: EngineContainer = {
  Id: '57521165561d3edafcef2b7ab5dcb774a5ea35479c64d3d53a1d0a63505c25f3',
  Names: ['/ai-portal-employee-read-api-backend-1'],
  Image: 'ai-portal-employee-read-api-backend',
  State: 'running',
  Status: 'Up 2 hours',
  Ports: [
    { PrivatePort: 8000, PublicPort: 8030, Type: 'tcp' },
    { PrivatePort: 8000, PublicPort: 8030, Type: 'tcp' },
    { PrivatePort: 9000, Type: 'tcp' },
  ],
  Labels: {
    'com.docker.compose.project': 'ai-portal-employee-read-api',
    'com.docker.compose.project.working_dir': '/home/me/work/ai-portal/.claude/worktrees/employee-read-api',
    'com.docker.compose.service': 'backend',
  },
};

test('belongsTo matches the compose working dir, ignoring trailing slashes', () => {
  assert.ok(belongsTo(backend, '/home/me/work/ai-portal/.claude/worktrees/employee-read-api/'));
  assert.ok(!belongsTo(backend, '/home/me/work/ai-portal'));
  assert.ok(!belongsTo({ ...backend, Labels: {} }, '/home/me/work/ai-portal'));
});

test('toServiceContainer maps labels, dedupes ports and drops unpublished ones', () => {
  const c = toServiceContainer(backend);
  assert.equal(c.name, 'backend');
  assert.equal(c.project, 'ai-portal-employee-read-api');
  assert.equal(c.kind, 'python');
  assert.equal(c.state, 'running');
  assert.deepEqual(c.ports, [{ host: 8030, container: 8000 }]);
  assert.equal(
    toServiceContainer({ ...backend, State: 'weird', Labels: undefined }).name,
    'ai-portal-employee-read-api-backend-1',
  );
});

test('kindOf heuristics', () => {
  const cases: [string, string, string][] = [
    ['postgres:16', 'db', 'postgres'],
    ['postgis/postgis:15', 'database', 'postgres'],
    ['redis:7-alpine', 'cache', 'redis'],
    ['rabbitmq:3-management', 'mq', 'rabbitmq'],
    ['ai-portal-backend', 'worker', 'celery'],
    ['ai-portal-backend', 'celery-beat', 'celery'],
    ['ai-portal-backend', 'backend', 'python'],
    ['python:3.12', 'app', 'python'],
    ['node:22', 'app', 'node'],
    ['shop-frontend', 'frontend', 'node'],
    ['nginx:1.27', 'proxy', 'nginx'],
    ['mailhog/mailhog', 'mail', 'other'],
  ];
  for (const [image, service, kind] of cases) assert.equal(kindOf(image, service), kind, `${image} ${service}`);
});

test('cpuPercent and memBytes like docker stats', () => {
  const stats = {
    cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 20_000, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 10_000 },
    memory_stats: { usage: 1000, stats: { inactive_file: 200 } },
  };
  assert.equal(cpuPercent(stats), 40);
  assert.equal(memBytes(stats), 800);
  assert.equal(cpuPercent({ ...stats, precpu_stats: {} }), undefined, 'one-shot stats have no previous sample');
  assert.equal(memBytes({ memory_stats: { usage: 500, stats: { cache: 100 } } }), 400);
  assert.equal(memBytes({}), undefined);
});

function frame(stream: number, text: string): Buffer {
  const payload = Buffer.from(text);
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

test('demux splits 8-byte framed stdout/stderr and passes TTY output through', () => {
  const buf = Buffer.concat([frame(1, 'a\n'), frame(2, 'b\n'), frame(1, 'c')]);
  assert.deepEqual(demux(buf), [
    { stream: 'stdout', data: 'a\n' },
    { stream: 'stderr', data: 'b\n' },
    { stream: 'stdout', data: 'c' },
  ]);
  assert.deepEqual(demux(Buffer.from('plain tty output\n')), [{ stream: 'stdout', data: 'plain tty output\n' }]);
  assert.deepEqual(demux(Buffer.alloc(0)), [{ stream: 'stdout', data: '' }]);
});

test('parseLogs splits timestamps and lines', () => {
  const buf = Buffer.concat([
    frame(1, '2026-10-19T14:56:22.285812128Z Starting server\n2026-10-19T14:56:23.1Z ready\r\n'),
    frame(2, '2026-10-19T14:57:00.000000000Z KeyError: x\n'),
  ]);
  assert.deepEqual(parseLogs(buf), [
    { stream: 'stdout', at: '2026-10-19T14:56:22.285812128Z', text: 'Starting server' },
    { stream: 'stdout', at: '2026-10-19T14:56:23.1Z', text: 'ready' },
    { stream: 'stderr', at: '2026-10-19T14:57:00.000000000Z', text: 'KeyError: x' },
  ]);
});

test('maskEnv hides secret-looking keys and URL passwords', () => {
  assert.deepEqual(
    maskEnv([
      'DJANGO_SECRET_KEY=abc',
      'POSTGRES_PASSWORD=pw',
      'GITLAB_TOKEN=t',
      'AWS_ACCESS_KEY_ID=k',
      'DJANGO_DEBUG=1',
      'DATABASE_URL=postgres://app:hunter2@db:5432/app',
      'BROKER=amqp://rabbit:5672//',
      'EMPTY',
    ]),
    [
      { key: 'DJANGO_SECRET_KEY', value: MASK, masked: true },
      { key: 'POSTGRES_PASSWORD', value: MASK, masked: true },
      { key: 'GITLAB_TOKEN', value: MASK, masked: true },
      { key: 'AWS_ACCESS_KEY_ID', value: MASK, masked: true },
      { key: 'DJANGO_DEBUG', value: '1', masked: false },
      { key: 'DATABASE_URL', value: `postgres://app:${MASK}@db:5432/app`, masked: true },
      { key: 'BROKER', value: 'amqp://rabbit:5672//', masked: false },
      { key: 'EMPTY', value: '', masked: false },
    ],
  );
});

test('toInspect maps mounts and ports', () => {
  const i = toInspect({
    Config: { Env: ['A=1'] },
    Mounts: [{ Type: 'bind', Source: '/src', Destination: '/app', RW: true }],
    NetworkSettings: {
      Ports: {
        '8000/tcp': [
          { HostIp: '0.0.0.0', HostPort: '8030' },
          { HostIp: '::', HostPort: '8030' },
        ],
        '9000/tcp': null,
      },
    },
  });
  assert.deepEqual(i.mounts, [{ type: 'bind', source: '/src', destination: '/app', rw: true }]);
  assert.deepEqual(i.ports, [
    { container: '8000/tcp', host: ['8030'] },
    { container: '9000/tcp', host: [] },
  ]);
});
