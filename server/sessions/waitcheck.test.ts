import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowRules, mcpServers, parseCheck, parseConnectors, userBashDenies } from './waitcheck.ts';

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

test('claude.ai connectors get their tool prefix from `claude mcp list`', () => {
  const out = [
    'Checking MCP server health…',
    'claude.ai GitHub: https://api.githubcopilot.com/mcp - ✔ Connected',
    'claude.ai GitLab Beyonder: https://mcp-externals.example/mcp - ✔ Connected',
    'claude.ai Windsor.ai: https://mcp.windsor.ai - ! Needs authentication',
    'gitlab: npx gitlab-mcp - ✔ Connected',
  ].join('\n');
  assert.deepEqual(parseConnectors(out), ['claude_ai_GitHub', 'claude_ai_GitLab_Beyonder', 'claude_ai_Windsor_ai']);
  assert.ok(allowRules([]).includes('Bash(gh pr view *)'));
});

test("the user's own Bash allow rules are denied, a bare Bash allow denies all of Bash", () => {
  const home = mkdtempSync(join(tmpdir(), 'shub-wait-'));
  const cwd = join(home, 'proj');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  const allow = (rules: string[]) => JSON.stringify({ permissions: { allow: rules } });
  writeFileSync(join(home, '.claude', 'settings.json'), allow(['Bash(glab mr update 1 *)', 'Bash(git log *)', 'Read']));
  writeFileSync(join(cwd, '.claude', 'settings.local.json'), allow(['Bash(npm test)']));
  const before = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    assert.deepEqual(userBashDenies(cwd, home), ['Bash(glab mr update 1 *)', 'Bash(npm test)']);
    writeFileSync(join(cwd, '.claude', 'settings.local.json'), allow(['Bash']));
    assert.deepEqual(userBashDenies(cwd, home), ['Bash']);
  } finally {
    if (before !== undefined) process.env.CLAUDE_CONFIG_DIR = before;
  }
});
