import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChat } from './chat.ts';

const jsonl = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
const user = (uuid: string, content: unknown, extra = {}) => ({ type: 'user', uuid, message: { content }, ...extra });
const assistant = (uuid: string, block: object, extra = {}) => ({
  type: 'assistant',
  uuid,
  message: { content: [block] },
  ...extra,
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
