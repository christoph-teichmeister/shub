import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { contextFill } from './context.ts';

const model = (modelId: string) => ({ type: 'attachment', attachment: { type: 'model', identity: { modelId } } });
const reply = (input: number, read: number, created: number, extra = {}) => ({
  type: 'assistant',
  message: {
    model: 'claude-opus-5-5',
    usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: created },
  },
  ...extra,
});
const compact = (postTokens: number) => ({
  type: 'system',
  subtype: 'compact_boundary',
  compactMetadata: { postTokens },
});

function transcript(...lines: object[]): string {
  const file = join(mkdtempSync(join(tmpdir(), 'shub-context-')), 't.jsonl');
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

test('contextFill sums the last reply and takes the window from the model attachment', () => {
  const file = transcript(model('claude-opus-5-5[1m]'), reply(1, 50_000, 10), reply(2, 79_215, 1_464));
  assert.deepEqual(contextFill(file), { tokens: 80_681, window: 1_000_000 });
  assert.deepEqual(contextFill(transcript(model('claude-sonnet-5-5'), reply(0, 1_000, 0))), {
    tokens: 1_000,
    window: 200_000,
  });
});

test('contextFill skips subagent lines and counts a compact as its post-compact size', () => {
  const file = transcript(model('claude-opus-5-5'), reply(0, 150_000, 0), reply(0, 9, 0, { isSidechain: true }));
  assert.deepEqual(contextFill(file), { tokens: 150_000, window: 200_000 });
  assert.deepEqual(contextFill(transcript(model('claude-opus-5-5'), reply(0, 190_000, 0), compact(16_689))), {
    tokens: 16_689,
    window: 200_000,
  });
});

test('contextFill finds an early model attachment past the tail, and anything over 200k is 1M', () => {
  const filler = { type: 'user', message: { content: 'x'.repeat(300 * 1024) } };
  const file = transcript(model('claude-opus-5-5[1m]'), filler, reply(0, 10_000, 0));
  assert.deepEqual(contextFill(file), { tokens: 10_000, window: 1_000_000 });
  assert.deepEqual(contextFill(file, 200_000), { tokens: 10_000, window: 200_000 });
  assert.deepEqual(contextFill(transcript(reply(0, 250_000, 0))), { tokens: 250_000, window: 1_000_000 });
  // The status line's window beats a model id without "[1m]".
  assert.deepEqual(contextFill(transcript(model('claude-opus-5-5'), reply(0, 170_000, 0)), 1_000_000), {
    tokens: 170_000,
    window: 1_000_000,
  });
  assert.equal(contextFill(transcript(model('claude-opus-5-5'))), null);
});
