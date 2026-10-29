import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RIGHTS, type ButtonDef, type ClientKind, type Right, type StartSessionRequest } from '../../shared/api.ts';
import type { Caller } from '../api/router.ts';
import type { PermissionAction } from '../services.ts';
import { ALL_RIGHTS, AUTO_START_LIMIT, buttonPromptDiff, decide, rightsFor, type DecideEnv } from './rules.ts';

const ids: Record<ClientKind, string> = {
  user: 'chris',
  cli: 'cli',
  'global-claude': 'session:global',
  session: 'session:s1',
  'spawned-session': 'session:s2',
  plugin: 'plugin:demo',
};
const caller = (kind: ClientKind, rights: Right[] = rightsFor(kind)): Caller => ({ kind, id: ids[kind], rights });
const button: ButtonDef = { id: 'b1', label: 'Review', prompt: 'review {input}', ask: 'text', confirm: false };
const env = { recentAutoStarts: 0, button };

function start(req: Partial<StartSessionRequest>, simpleInput = true): PermissionAction {
  const request: StartSessionRequest = { projectId: 'p1', kind: 'claude', ...req };
  return { kind: 'session.start', request, viaButton: request.buttonId !== undefined, simpleInput };
}
const viaButton = start({ buttonId: 'b1', input: 'MR 12' });
const freePrompt = start({ prompt: 'do things' });
const outcome = (c: Caller, a: PermissionAction, e: DecideEnv = env) => decide(c, a, e).outcome;

test('user may do everything', () => {
  const u = caller('user');
  for (const a of [
    viaButton,
    freePrompt,
    { kind: 'projects.write', projectId: null },
    { kind: 'projects.delete', projectId: 'p1' },
    { kind: 'buttons.write', projectId: 'p1', diff: '+x' },
    { kind: 'session.close', sessionId: 'other' },
    { kind: 'session.link', sessionId: 'x' },
    { kind: 'ui.contribute' },
  ] satisfies PermissionAction[]) {
    assert.equal(outcome(u, a), 'allow', a.kind);
  }
});

test("trustSessions turns a session's asks into allows, keeps the limit and one level deep", () => {
  const s = caller('session');
  const trust = { ...env, trustSessions: true };
  assert.equal(outcome(s, freePrompt), 'ask');
  assert.equal(outcome(s, freePrompt, trust), 'allow');
  assert.equal(outcome(s, { kind: 'buttons.write' } as PermissionAction, trust), 'allow');
  assert.equal(outcome(s, freePrompt, { ...trust, recentAutoStarts: AUTO_START_LIMIT }), 'ask');
  assert.equal(outcome(caller('spawned-session'), freePrompt, trust), 'deny');
  assert.equal(outcome(caller('plugin'), freePrompt, trust), 'deny');
});

test('user is not rate limited', () => {
  assert.equal(outcome(caller('user'), freePrompt, { ...env, recentAutoStarts: 99 }), 'allow');
});

test('global Claude: button with simple input allowed, free prompt asks', () => {
  const g = caller('global-claude');
  assert.equal(outcome(g, viaButton), 'allow');
  assert.equal(outcome(g, freePrompt), 'ask');
  assert.equal(outcome(g, start({ buttonId: 'b1', input: 'x\ny' }, false)), 'ask');
  assert.equal(outcome(g, start({})), 'ask', 'empty session counts as free start');
  assert.equal(outcome(g, { kind: 'projects.write', projectId: 'p1' }), 'allow');
});

test('global Claude may not delete projects, close other sessions or write buttons directly', () => {
  const g = caller('global-claude');
  assert.equal(outcome(g, { kind: 'projects.delete', projectId: 'p1' }), 'deny');
  assert.equal(outcome(g, { kind: 'session.close', sessionId: 's9' }), 'deny');
  assert.equal(outcome(g, { kind: 'buttons.write', projectId: 'p1', diff: '' }), 'ask');
  assert.equal(outcome(g, { kind: 'ui.contribute' }), 'deny');
});

test('project session: reads only, every write asks, never allowed', () => {
  const s = caller('session');
  for (const a of [
    viaButton,
    freePrompt,
    { kind: 'projects.write', projectId: 'p1' },
    { kind: 'buttons.write', projectId: 'p1', diff: '' },
    { kind: 'session.link', sessionId: 's9' },
  ] satisfies PermissionAction[]) {
    assert.equal(outcome(s, a), 'ask', a.kind);
  }
  assert.equal(outcome(s, { kind: 'projects.delete', projectId: 'p1' }), 'deny');
  assert.equal(outcome(s, { kind: 'session.close', sessionId: 's9' }), 'deny');
  assert.equal(outcome(s, { kind: 'session.close', sessionId: 's1' }), 'allow', 'may close itself');
  assert.equal(outcome(s, { kind: 'session.link', sessionId: 's1' }), 'allow', 'may link its own tab');
});

test('spawned session: no write at all', () => {
  const s = caller('spawned-session');
  for (const a of [
    viaButton,
    freePrompt,
    { kind: 'projects.write', projectId: 'p1' },
    { kind: 'buttons.write', projectId: 'p1', diff: '' },
    { kind: 'session.link', sessionId: 's2' },
    { kind: 'projects.delete', projectId: 'p1' },
    { kind: 'session.close', sessionId: 's1' },
    { kind: 'ui.contribute' },
  ] satisfies PermissionAction[]) {
    assert.equal(outcome(s, a), 'deny', a.kind);
  }
});

test('plugin without grants: denied everything', () => {
  const p = caller('plugin', []);
  for (const a of [
    viaButton,
    freePrompt,
    { kind: 'projects.write', projectId: 'p1' },
    { kind: 'buttons.write', projectId: 'p1', diff: '' },
    { kind: 'session.link', sessionId: 's1' },
    { kind: 'ui.contribute' },
  ] satisfies PermissionAction[]) {
    assert.equal(outcome(p, a), 'deny', a.kind);
  }
});

test('plugin: button start allowed with sessions.start.button, free prompt asks with sessions.start', () => {
  assert.equal(outcome(caller('plugin', ['sessions.start.button']), viaButton), 'allow');
  assert.equal(outcome(caller('plugin', ['sessions.start.button']), freePrompt), 'deny');
  assert.equal(
    outcome(caller('plugin', ['sessions.start.button']), start({ buttonId: 'b1', input: 'a\nb' }, false)),
    'ask',
  );
  assert.equal(outcome(caller('plugin', ['sessions.start']), freePrompt), 'ask');
  assert.equal(outcome(caller('plugin', ['sessions.start']), viaButton), 'ask');
  assert.equal(outcome(caller('plugin', ALL_RIGHTS), freePrompt), 'ask', 'free prompt never auto-allowed');
});

test('plugin: other rights only when granted; buttons.write still asks', () => {
  const p = caller('plugin', ['projects.write', 'sessions.link', 'ui.contribute', 'buttons.write']);
  assert.equal(outcome(p, { kind: 'projects.write', projectId: 'p1' }), 'allow');
  assert.equal(outcome(p, { kind: 'session.link', sessionId: 's1' }), 'allow');
  assert.equal(outcome(p, { kind: 'ui.contribute' }), 'allow');
  assert.equal(outcome(p, { kind: 'buttons.write', projectId: 'p1', diff: '' }), 'ask');
  assert.equal(outcome(p, { kind: 'projects.delete', projectId: 'p1' }), 'deny');
  assert.equal(outcome(p, { kind: 'session.close', sessionId: 's1' }), 'deny');
});

test('cli: like user, but buttons.write asks and starts are rate limited', () => {
  const c = caller('cli');
  assert.equal(outcome(c, freePrompt), 'allow');
  assert.equal(outcome(c, { kind: 'projects.delete', projectId: 'p1' }), 'allow');
  assert.equal(outcome(c, { kind: 'session.close', sessionId: 's9' }), 'allow');
  assert.equal(outcome(c, { kind: 'buttons.write', projectId: 'p1', diff: '' }), 'ask');
  assert.equal(outcome(c, freePrompt, { ...env, recentAutoStarts: AUTO_START_LIMIT }), 'ask');
});

test('rate limit downgrades allow to ask with a reason, never upgrades', () => {
  const g = caller('global-claude');
  assert.equal(outcome(g, viaButton, { ...env, recentAutoStarts: AUTO_START_LIMIT - 1 }), 'allow');
  const d = decide(g, viaButton, { ...env, recentAutoStarts: AUTO_START_LIMIT });
  assert.equal(d.outcome, 'ask');
  assert.match(d.outcome === 'ask' ? d.reason : '', /last hour/);
  const p = caller('plugin', ['sessions.start.button']);
  assert.equal(outcome(p, viaButton, { ...env, recentAutoStarts: 10 }), 'ask');
  assert.equal(outcome(caller('spawned-session'), viaButton, { ...env, recentAutoStarts: 10 }), 'deny');
});

test('inconsistent start requests are rejected for everyone', () => {
  const locked: ButtonDef = { ...button, permissionMode: 'bypassPermissions', lockDefaultMode: true };
  for (const kind of ['user', 'cli', 'global-claude'] as ClientKind[]) {
    const c = caller(kind);
    assert.equal(outcome(c, viaButton, { ...env, button: locked }), 'deny', `${kind} locked`);
    assert.equal(outcome(c, start({ buttonId: 'b1', prompt: 'x' })), 'deny', `${kind} both`);
    assert.equal(outcome(c, viaButton, { recentAutoStarts: 0 }), 'deny', `${kind} unknown button`);
    const lying: PermissionAction = {
      kind: 'session.start',
      request: { projectId: 'p1', kind: 'claude', prompt: 'x' },
      viaButton: true,
      simpleInput: true,
    };
    assert.equal(outcome(c, lying), 'deny', `${kind} viaButton without buttonId`);
  }
});

test('prompt-skipping mode allowed when the button explicitly sets it and is not locked', () => {
  const auto: ButtonDef = { ...button, permissionMode: 'auto' };
  assert.equal(outcome(caller('global-claude'), viaButton, { ...env, button: auto }), 'allow');
  const lockedDefault: ButtonDef = { ...button, permissionMode: 'default', lockDefaultMode: true };
  assert.equal(outcome(caller('global-claude'), viaButton, { ...env, button: lockedDefault }), 'allow');
});

test('rightsFor', () => {
  assert.deepEqual([...RIGHTS].sort(), [...ALL_RIGHTS].sort(), 'shared RIGHTS lists every Right');
  assert.deepEqual(rightsFor('user'), ALL_RIGHTS);
  assert.deepEqual(rightsFor('cli'), ALL_RIGHTS);
  assert.deepEqual(rightsFor('session'), ['read']);
  assert.deepEqual(rightsFor('spawned-session'), ['read']);
  assert.ok(rightsFor('global-claude').includes('projects.write'));
  assert.ok(!rightsFor('global-claude').includes('buttons.write'));
  assert.deepEqual(rightsFor('plugin'), []);
  assert.deepEqual(rightsFor('plugin', ['ui.contribute', 'bogus' as Right, 'read']), ['read', 'ui.contribute']);
});

test('buttonPromptDiff shows added, changed and removed prompts', () => {
  const a: ButtonDef = { id: 'a', label: 'A', prompt: 'one', ask: 'nothing', confirm: false };
  const b: ButtonDef = { id: 'b', label: 'B', prompt: 'two', ask: 'nothing', confirm: false };
  const diff = buttonPromptDiff(
    [a, b],
    [
      { ...a, prompt: 'ONE', permissionMode: 'auto' },
      { ...b, id: 'c', label: 'C' },
    ],
  );
  assert.equal(diff, ['- A: one', '+ A: ONE | mode: auto', '+ C: two', '- B: two'].join('\n'));
  assert.equal(buttonPromptDiff([a], [a]), '');
});
