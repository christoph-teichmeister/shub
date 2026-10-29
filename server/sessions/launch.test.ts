import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { ButtonDef } from '../../shared/api.ts';
import {
  autoName,
  buttonPrompt,
  claudeArgs,
  defaultLauncher,
  RUN_HINT,
  isSimpleInput,
  permissionModeFor,
  shellRc,
} from './launch.ts';
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
  // trusted session starts bypass; a button's mode and the lock still win
  assert.equal(permissionModeFor(undefined, 'default', false, true), 'bypassPermissions');
  assert.equal(permissionModeFor(button({ permissionMode: 'plan' }), 'default', false, true), 'plan');
  assert.equal(permissionModeFor(button({ lockDefaultMode: true }), 'default', false, true), 'default');
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
  assert.deepEqual(claudeArgs({ ...spec, prompt: '-p evil', resume: false }), [
    'claude',
    '--session-id',
    'u',
    '--settings',
    '/s.json',
    '--append-system-prompt',
    RUN_HINT,
    '--permission-mode',
    'default',
    '--',
    '-p evil',
  ]);
  assert.deepEqual(claudeArgs({ ...spec, prompt: 'x', resume: true }).slice(0, 3), ['claude', '--resume', 'u']);
  assert.deepEqual(claudeArgs({ ...spec, permissionMode: 'auto', resume: false }).slice(-2), [
    '--permission-mode',
    'auto',
  ]);
});

test('inherit passes no --permission-mode flag', () => {
  const argv = claudeArgs({
    kind: 'claude',
    claudeSessionId: 'u',
    settingsFile: '/s.json',
    permissionMode: 'inherit',
    prompt: 'hi',
    resume: false,
  });
  assert.deepEqual(argv, [
    'claude',
    '--session-id',
    'u',
    '--settings',
    '/s.json',
    '--append-system-prompt',
    RUN_HINT,
    '--',
    'hi',
  ]);
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

test('in a shub terminal, bare `claude` runs `shub claude`; with arguments the real claude without the id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shub-rc-'));
  try {
    const script = (name: string, body: string) => {
      writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(dir, name), 0o755);
    };
    script('shub', 'echo "shub $*"');
    script('claude', 'echo "real $* id=${SHUB_SESSION_ID:-none}"');
    writeFileSync(join(dir, 'rc'), shellRc(join(dir, 'shub')));
    const run = (line: string) =>
      execFileSync('bash', ['--rcfile', join(dir, 'rc'), '-i', '-c', line], {
        encoding: 'utf8',
        env: { HOME: dir, PATH: `${dir}:/usr/bin:/bin`, SHUB_SESSION_ID: 'p-sh1' },
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    assert.equal(run('claude'), 'shub claude');
    assert.equal(run('claude -p hi'), 'real -p hi id=none');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claude sessions fall back to a login shell when claude exits', () => {
  const argv = defaultLauncher({
    kind: 'claude',
    claudeSessionId: 'u',
    settingsFile: '/s.json',
    permissionMode: 'default',
    resume: false,
  });
  assert.deepEqual(argv.slice(0, 2), ['/bin/sh', '-c']);
  assert.match(argv[2], /^claude "\$@"; exec /);
  assert.deepEqual(argv.slice(4, 7), ['--session-id', 'u', '--settings']);
});
