import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ButtonDef } from '../../shared/api.ts';
import { autoName, buttonPrompt, defaultLauncher, isSimpleInput, permissionModeFor } from './launch.ts';
import { encodeCwd, summarizeTranscript } from './old.ts';

const button = (extra: Partial<ButtonDef>): ButtonDef => ({
  id: 'b',
  label: 'Review',
  ask: 'text',
  confirm: false,
  ...extra,
});

test('button prompts: skill + input, or prompt with {input}', () => {
  assert.equal(buttonPrompt(button({ skill: '/worktree-start' }), '#12'), '/worktree-start #12');
  assert.equal(buttonPrompt(button({ skill: '/x' })), '/x');
  assert.equal(buttonPrompt(button({ prompt: 'Fix {input} now, {input}!' }), 'bug'), 'Fix bug now, bug!');
});

test('simple input', () => {
  assert.ok(isSimpleInput(undefined));
  assert.ok(isSimpleInput('feature/abc-12#3'));
  assert.ok(!isSimpleInput('a b'));
  assert.ok(!isSimpleInput('x'.repeat(81)));
});

test('permission modes: button wins, lock stays default, only the user gets the setting', () => {
  assert.equal(permissionModeFor(undefined), 'default');
  assert.equal(permissionModeFor(button({ permissionMode: 'bypassPermissions' })), 'bypassPermissions');
  assert.equal(permissionModeFor(button({ permissionMode: 'auto', lockDefaultMode: true })), 'default');
  // the app setting, for user starts only
  assert.equal(permissionModeFor(undefined, 'auto', true), 'auto');
  assert.equal(permissionModeFor(button({}), 'inherit', true), 'inherit');
  assert.equal(permissionModeFor(undefined, 'auto', false), 'default');
  assert.equal(permissionModeFor(button({}), 'bypassPermissions', false), 'default');
  // a button's own mode and the lock beat the setting
  assert.equal(permissionModeFor(button({ permissionMode: 'plan' }), 'auto', true), 'plan');
  assert.equal(permissionModeFor(button({ lockDefaultMode: true }), 'auto', true), 'default');
  assert.equal(permissionModeFor(button({ lockDefaultMode: true }), 'inherit', true), 'default');
});

test('auto names', () => {
  assert.equal(autoName({ button: button({}), input: '#7', n: 1 }), 'Review #7');
  assert.equal(autoName({ prompt: 'one two three four five six seven', n: 1 }), 'one two three four five six…');
  assert.equal(autoName({ n: 3 }), 'Session 3');
});

test('claude argv names the mode and puts the prompt after --', () => {
  const spec = {
    kind: 'claude' as const,
    claudeSessionId: 'u',
    settingsFile: '/s.json',
    permissionMode: 'default' as const,
  };
  assert.deepEqual(defaultLauncher({ ...spec, prompt: '-p evil', resume: false }), [
    'claude',
    '--session-id',
    'u',
    '--settings',
    '/s.json',
    '--permission-mode',
    'default',
    '--',
    '-p evil',
  ]);
  assert.deepEqual(defaultLauncher({ ...spec, prompt: 'x', resume: true }).slice(0, 3), ['claude', '--resume', 'u']);
  assert.deepEqual(defaultLauncher({ ...spec, permissionMode: 'auto', resume: false }).slice(-2), [
    '--permission-mode',
    'auto',
  ]);
});

test('inherit passes no --permission-mode flag', () => {
  const argv = defaultLauncher({
    kind: 'claude',
    claudeSessionId: 'u',
    settingsFile: '/s.json',
    permissionMode: 'inherit',
    prompt: 'hi',
    resume: false,
  });
  assert.deepEqual(argv, ['claude', '--session-id', 'u', '--settings', '/s.json', '--', 'hi']);
});

test('cwd encoding matches ~/.claude/projects folder names', () => {
  assert.equal(
    encodeCwd('/home/me/PycharmProjects/private/tickie/.claude/worktrees/pwa-cache'),
    '-home-me-PycharmProjects-private-tickie--claude-worktrees-pwa-cache',
  );
});

test('transcript summary counts real prompts only', () => {
  const lines = [
    { type: 'user', isMeta: true, message: { content: 'caveat' } },
    { type: 'user', message: { content: '<command-name>/clear</command-name>' } },
    { type: 'user', message: { content: [{ type: 'text', text: 'Fix the login' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } },
    { type: 'user', message: { content: 'and the tests' } },
  ];
  const jsonl = lines.map((l) => JSON.stringify(l)).join('\n') + '\n{"broken';
  assert.deepEqual(summarizeTranscript(jsonl), { firstPrompt: 'Fix the login', turns: 2 });
});
