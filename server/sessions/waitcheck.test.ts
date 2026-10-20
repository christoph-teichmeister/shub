import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowRules, mcpServers, parseCheck } from './waitcheck.ts';

test('parseCheck reads the last DONE / NOT YET line', () => {
  assert.deepEqual(parseCheck('Looking at the MR…\nNOT YET: no reply from Kai'), {
    done: false,
    summary: 'no reply from Kai',
  });
  assert.deepEqual(parseCheck('**DONE: Kai answered at 14:02**'), { done: true, summary: 'Kai answered at 14:02' });
  assert.equal(parseCheck('I could not reach GitLab.'), null);
});

test('allow rules name each MCP server: user-wide, per project and .mcp.json', () => {
  const home = mkdtempSync(join(tmpdir(), 'shub-wait-'));
  const cwd = join(home, 'proj');
  mkdirSync(cwd);
  const user = { mcpServers: { gitlab: {} }, projects: { [cwd]: { mcpServers: { local: {} } } } };
  writeFileSync(join(home, '.claude.json'), JSON.stringify(user));
  writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { gitlab: {}, shared: {} } }));
  const before = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    assert.deepEqual(mcpServers(cwd, home), ['gitlab', 'local', 'shared']);
  } finally {
    if (before !== undefined) process.env.CLAUDE_CONFIG_DIR = before;
  }
  const rules = allowRules(['gitlab']);
  assert.ok(rules.includes('mcp__gitlab__browse*'));
  assert.ok(!rules.some((r) => r.startsWith('mcp__*')), 'a * server never matches in allow rules');
});
