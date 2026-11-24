import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costUsd } from './prices.ts';
import { buildReport, digest, type StatRow } from './report.ts';
import { sumUsage } from './tokens.ts';

const now = new Date(2026, 10, 24, 12, 0).getTime();
const min = 60_000;
const row = (ts: number, kind: string, a = '', extra: Partial<StatRow> = {}): StatRow => ({
  ts,
  session: 's1',
  project: 'p1',
  kind,
  a,
  b: '',
  n: 0,
  ...extra,
});

test('status spans become working and needs-you time, with the median wait', () => {
  const rows = [
    row(now - 30 * min, 'status', 'working'),
    row(now - 20 * min, 'status', 'needs-you'),
    row(now - 14 * min, 'status', 'working'),
    row(now - 10 * min, 'status', 'your-turn'),
    row(now - 5 * min, 'closed'),
  ];
  const r = buildReport(rows, 7, now, () => 'Session');
  const today = r.daily.at(-1)!;
  assert.equal(today.workingMs, 14 * min);
  assert.equal(today.needsYouMs, 6 * min);
  assert.equal(today.yourTurnMs, 5 * min);
  assert.equal(today.medianNeedsYouMs, 6 * min);
  assert.equal(r.sessions.started, 1);
  assert.equal(r.projects[0].projectId, 'p1');
});

test('tools, asked commands, commits, streak and limit hits', () => {
  const rows = [
    row(now - 3 * min, 'tool', 'Bash'),
    row(now - 3 * min, 'asked', 'Bash', { b: 'git push' }),
    row(now - 2 * min, 'denied', 'Bash'),
    row(now - 2 * min, 'commit'),
    row(now - 86400_000, 'commit'),
    row(now - 2 * min, 'limit', '10', { n: 100, session: '' }),
    row(now - 1 * min, 'limit', '10', { n: 100, session: '' }),
  ];
  const r = buildReport(rows, 7, now, () => 'x');
  assert.deepEqual(r.tools[0], { tool: 'Bash', count: 1, asked: 1, denied: 1 });
  assert.deepEqual(r.asked[0], { command: 'Bash: git push', count: 1 });
  assert.equal(r.streak, 2);
  assert.equal(r.limitHits, 1);
});

test('transcript usage counts a message once and sums per model', () => {
  const line = (id: string, out: number) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-11-24T10:00:00Z',
      message: { id, model: 'm', usage: { input_tokens: 1, output_tokens: out, cache_read_input_tokens: 5 } },
    });
  const rows = sumUsage([line('a', 2), line('a', 2), line('b', 3), 'noise "usage"'].join('\n'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].tokens, { input: 1, output: 3, cacheRead: 5, cacheCreate: 0 });
});

test('cost uses the model family price, dated ids included, unknown models cost nothing', () => {
  const t = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreate: 1_000_000 };
  assert.equal(costUsd('claude-opus-5-5', t), 4 + 20 + 0.2 + 5);
  assert.equal(costUsd('claude-haiku-4-5-20251001', t), 1 + 5 + 0.1 + 1.25);
  assert.equal(costUsd('claude-sonnet-5-5', t), 2 + 10 + 0.1 + 2.5);
  assert.equal(costUsd('something-else', t), 0);
});

test('report carries the cost and the digest names the main numbers', () => {
  const t = { input: 1_000_000, output: 0, cacheRead: 0, cacheCreate: 0 };
  const rows = [row(now - min, 'tokens', 'claude-opus-5-5', { b: JSON.stringify(t) }), row(now - min, 'commit')];
  const r = buildReport(rows, 7, now, () => 'x');
  assert.equal(r.daily.at(-1)!.costUsd, 4);
  assert.equal(r.models[0].costUsd, 4);
  const d = digest(r);
  assert.match(d.body, /\$4\.00 at API rates, most on claude-opus-5-5/);
  assert.match(d.body, /1 commits/);
});
