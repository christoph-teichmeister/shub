import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chatSince, followTranscript, parseChat } from './chat.ts';

const jsonl = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
const user = (uuid: string, content: unknown, extra = {}) => ({ type: 'user', uuid, message: { content }, ...extra });
const assistant = (uuid: string, block: object, extra = {}) => ({
  type: 'assistant',
  uuid,
  message: { content: [block] },
  ...extra,
});

test('followTranscript nudges once per burst of appends and lets go after the idle time', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'chat-')), 't.jsonl');
  writeFileSync(file, '');
  let calls = 0;
  followTranscript(file, () => calls++, 30, 200);
  followTranscript(file, () => calls++, 30, 200); // same file: no second watcher
  appendFileSync(file, 'a\n');
  appendFileSync(file, 'b\n');
  await sleep(120);
  assert.equal(calls, 1);
  await sleep(300); // idle: watcher closed
  appendFileSync(file, 'c\n');
  await sleep(120);
  assert.equal(calls, 1);
});

test('parseChat keeps a prompt that merely starts with "<"', () => {
  const out = parseChat(jsonl(user('u1', '<b>x</b> please'), user('u2', '<system-reminder>x</system-reminder>')));
  assert.deepEqual(out, [{ id: 'u1:0', role: 'user', text: '<b>x</b> please' }]);
});

test('parseChat survives a cut first line, an orphan result and a repeated tool id', () => {
  const out = parseChat(
    '{"type":"assistant","message":{"content":[{"type":"tex\n' +
      jsonl(
        user('u0', [{ type: 'tool_result', tool_use_id: 'gone', content: 'x', is_error: true }]),
        assistant('a1', { type: 'tool_use', id: 't1', name: 'Bash', input: {} }),
        assistant('a2', { type: 'tool_use', id: 't1', name: 'Bash', input: {} }),
      ),
  );
  assert.deepEqual(
    out.map((m) => m.id),
    ['t1'],
  );
});

test('parseChat keeps prompts and replies, and drops thinking, subagents, meta and command wrappers', () => {
  const out = parseChat(
    jsonl(
      user('u1', 'fix the bug'),
      user('u2', '<command-name>/clear</command-name>'),
      user('u3', [{ type: 'text', text: 'injected' }], { isMeta: true }),
      assistant('a1', { type: 'thinking', thinking: 'hmm' }),
      assistant('a2', { type: 'text', text: '  Done.  ' }),
      assistant('a3', { type: 'text', text: 'subagent' }, { isSidechain: true }),
      { type: 'ai-title', aiTitle: 'x' },
    ),
  );
  assert.deepEqual(out, [
    { id: 'u1:0', role: 'user', text: 'fix the bug' },
    { id: 'a2:0', role: 'assistant', text: 'Done.' },
  ]);
});

test('parseChat shows a tool call with a short summary and the status of its result', () => {
  const out = parseChat(
    jsonl(
      assistant('a1', { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls\nsecond line' } }),
      assistant('a2', { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/x.ts' } }),
      assistant('a3', { type: 'tool_use', id: 't3', name: 'Edit', input: {} }),
      user('u1', [{ type: 'tool_result', tool_use_id: 't1', content: 'a' }]),
      user('u2', [{ type: 'tool_result', tool_use_id: 't2', content: 'b', is_error: true }]),
    ),
  );
  assert.deepEqual(
    out.map((m) => m.role === 'tool' && [m.name, m.summary, m.status]),
    [
      ['Bash', 'ls', 'ok'],
      ['Read', '/x.ts', 'error'],
      ['Edit', '', 'running'],
    ],
  );
});

test('parseChat ignores a half-written last line and keeps only the newest messages', () => {
  const lines = Array.from({ length: 5 }, (_, i) => user(`u${i}`, `m${i}`));
  const out = parseChat(jsonl(...lines) + '{"type":"assistant","mess', 2);
  assert.deepEqual(
    out.map((m) => m.id),
    ['u3:0', 'u4:0'],
  );
});

test('chatSince reads only new complete lines, patches earlier tool calls and falls back to a full load', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'chat-')), 't.jsonl');
  const call = assistant('a1', { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } });
  writeFileSync(file, jsonl(user('u1', 'hi'), call));
  const first = chatSince(file);
  assert.deepEqual(
    first.messages.map((m) => m.id),
    ['u1:0', 't1'],
  );
  assert.equal(first.reset, true);
  // The result arrives, plus a half-written line that must wait.
  const result = user('u2', [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'out' }] }]);
  appendFileSync(file, jsonl(result) + '{"type":"assis');
  const delta = chatSince(file, first.offset);
  assert.equal(delta.reset, false);
  assert.deepEqual(delta.messages, [{ id: 't1', role: 'tool', name: '', summary: '', status: 'ok', result: 'out' }]);
  assert.equal(chatSince(file, delta.offset).messages.length, 0);
  // Truncated (offset past the end): full load.
  writeFileSync(file, jsonl(user('u3', 'new')));
  const again = chatSince(file, delta.offset);
  assert.equal(again.reset, true);
  assert.deepEqual(
    again.messages.map((m) => m.id),
    ['u3:0'],
  );
});
