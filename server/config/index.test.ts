import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerEvent } from '../../shared/api.ts';
import { EventBus } from '../context.ts';
import { DEFAULT_ACCENT, FileConfigStore, hostOfRemote, iconForHost, webUrlOfRemote } from './index.ts';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'shub-config-'));
}

function project(id: string, path: string, icon: any = { kind: 'auto' }) {
  return { id, name: id, path, group: '', visibility: 'pinned' as const, order: 0, icon, buttons: [] };
}

test('fresh install gets defaults and writes the file', () => {
  const dir = tmp();
  const store = new FileConfigStore(dir, new EventBus());
  const config = store.get();
  assert.deepEqual(config.projects, []);
  assert.deepEqual(config.groups, []);
  assert.equal(config.activeTheme, 'monokai');
  assert.equal(config.defaultPermissionMode, 'default');
  assert.deepEqual(
    config.themes.map((t) => t.id),
    ['monokai', 'dracula', 'neutral-dark'],
  );
  assert.equal(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).activeTheme, 'monokai');
});

test('update writes atomically, persists and emits events', () => {
  const dir = tmp();
  const bus = new EventBus();
  const events: ServerEvent['type'][] = [];
  bus.on((e) => events.push(e.type));
  const store = new FileConfigStore(dir, bus);
  store.update((c) => c.projects.push(project('a', dir)), 'test');
  store.update((c) => (c.activeTheme = 'dracula'), 'test');
  assert.deepEqual(events, ['config.changed', 'projects.changed', 'config.changed']);
  assert.deepEqual(readdirSync(dir), ['config.json']);
  const reopened = new FileConfigStore(dir, new EventBus());
  assert.equal(reopened.project('a')?.path, dir);
  assert.equal(reopened.get().activeTheme, 'dracula');
  store.update((c) => (c.defaultPermissionMode = 'inherit'), 'test');
  assert.equal(new FileConfigStore(dir, new EventBus()).get().defaultPermissionMode, 'inherit');
  store.update((c) => (c.defaultPermissionMode = 'yolo' as never), 'test');
  assert.equal(store.get().defaultPermissionMode, 'default');
});

test('remote hosts map to icons', () => {
  assert.equal(hostOfRemote('git@github.com:a/b.git'), 'github.com');
  assert.equal(hostOfRemote('https://gitlab.example.de/a/b'), 'gitlab.example.de');
  assert.equal(hostOfRemote('ssh://git@git.example.org:22/a.git'), 'git.example.org');
  assert.equal(iconForHost('github.com').kind, 'github');
  assert.equal(iconForHost('gitlab.example.de').kind, 'gitlab');
  assert.equal(iconForHost('git.example.org').kind, 'none');
});

test('remotes map to browser URLs', () => {
  assert.equal(webUrlOfRemote('git@github.com:a/b.git'), 'https://github.com/a/b');
  assert.equal(webUrlOfRemote('ssh://git@git.example.org:22/g/sub/r.git'), 'https://git.example.org/g/sub/r');
  assert.equal(webUrlOfRemote('https://user:token@GitLab.example.de/a/b.git/'), 'https://gitlab.example.de/a/b');
  assert.equal(webUrlOfRemote('/srv/git/repo.git'), null);
  assert.equal(webUrlOfRemote('file:///srv/git/repo.git'), null);
});

test('projectView resolves auto icons from git and picks the accent', () => {
  const dir = tmp();
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'git@gitlab.example.com:x/y.git']);
  const store = new FileConfigStore(join(dir, 'cfg'), new EventBus());
  store.update((c) => {
    c.projects.push(project('auto', repo));
    c.projects.push(project('sym', repo, { kind: 'symbol', symbol: 'K', color: '#a6e22e' }));
    c.projects.push(project('orange', repo, { kind: 'symbol', symbol: 'O', color: '#FD971F' }));
    c.projects.push(project('plain', dir));
  }, 'test');
  const auto = store.projectView('auto')!;
  assert.equal(auto.resolvedIcon.kind, 'gitlab');
  assert.equal(auto.accent, DEFAULT_ACCENT);
  assert.equal(auto.remoteUrl, 'https://gitlab.example.com/x/y');
  assert.equal(store.projectView('plain')!.remoteUrl, undefined);
  assert.equal(store.projectView('sym')!.accent, '#a6e22e');
  assert.equal(store.projectView('orange')!.accent, DEFAULT_ACCENT);
  assert.equal(store.projectView('plain')!.resolvedIcon.kind, 'none');
});

test('paths under home are stored as ~ and expanded on read; missing folders are flagged', () => {
  const home = tmp();
  const cfg = join(home, 'cfg');
  const repo = join(home, 'code', 'repo');
  mkdirSync(repo, { recursive: true });
  const store = new FileConfigStore(cfg, new EventBus(), home);
  store.update((c) => {
    c.projects.push(project('here', repo));
    c.projects.push(project('elsewhere', join(home, 'not-cloned')));
    c.projects.push(project('outside', '/opt/x'));
  }, 'test');
  const onDisk = JSON.parse(readFileSync(join(cfg, 'config.json'), 'utf8'));
  assert.deepEqual(
    onDisk.projects.map((p: { path: string }) => p.path),
    ['~/code/repo', '~/not-cloned', '/opt/x'],
  );
  // Another machine with another home reads the same file.
  const otherHome = tmp();
  writeFileSync(join(otherHome, 'config.json'), JSON.stringify(onDisk));
  const other = new FileConfigStore(otherHome, new EventBus(), otherHome);
  assert.equal(other.project('here')?.path, join(otherHome, 'code', 'repo'));
  assert.equal(store.projectView('here')!.missing, undefined);
  assert.equal(store.projectView('elsewhere')!.missing, true);
});

test('local.json wins over config.json and keeps machine-only keys out of it', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ activeTheme: 'dracula', defaultPermissionMode: 'plan' }));
  writeFileSync(join(dir, 'local.json'), JSON.stringify({ defaultPermissionMode: 'acceptEdits' }));
  const store = new FileConfigStore(dir, new EventBus());
  assert.equal(store.get().defaultPermissionMode, 'acceptEdits');
  store.update((c) => {
    c.defaultPermissionMode = 'default';
    c.updateChannel = 'beta';
    c.activeTheme = 'monokai';
  }, 'test');
  const shared = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  const local = JSON.parse(readFileSync(join(dir, 'local.json'), 'utf8'));
  assert.equal(shared.activeTheme, 'monokai');
  assert.equal(shared.defaultPermissionMode, 'plan'); // untouched: this machine overrides it
  assert.equal(shared.updateChannel, undefined);
  assert.deepEqual(local, { defaultPermissionMode: 'default', updateChannel: 'beta' });
});

test('reload picks up outside edits, emits once, and ignores broken files', () => {
  const dir = tmp();
  const bus = new EventBus();
  const events: ServerEvent['type'][] = [];
  bus.on((e) => events.push(e.type));
  const store = new FileConfigStore(dir, bus);
  store.reload();
  assert.deepEqual(events, []);
  const file = join(dir, 'config.json');
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...onDisk, groups: ['Work'] }));
  store.reload();
  assert.deepEqual(store.get().groups, ['Work']);
  assert.deepEqual(events, ['config.changed', 'projects.changed']);
  writeFileSync(file, '{ half a git merge');
  store.reload();
  assert.deepEqual(store.get().groups, ['Work']);
  assert.match(store.get().problem!, /not readable/);
  assert.throws(() => store.update((c) => (c.activeTheme = 'dracula'), 'test'), /not readable/);
  assert.equal(readFileSync(file, 'utf8'), '{ half a git merge'); // the conflict is left for the user
  writeFileSync(file, JSON.stringify({ ...onDisk, groups: ['Fixed'] }));
  store.reload();
  assert.equal(store.get().problem, undefined);
  assert.deepEqual(store.get().groups, ['Fixed']);
});

test('a broken file at startup runs on the last good config instead of failing', () => {
  const dir = tmp();
  const lastGood = join(dir, 'state', 'config.last-good.json');
  const store = new FileConfigStore(join(dir, 'cfg'), new EventBus(), dir, lastGood);
  store.update((c) => (c.groups = ['Work']), 'test');
  writeFileSync(join(dir, 'cfg', 'config.json'), '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> theirs\n');
  const restarted = new FileConfigStore(join(dir, 'cfg'), new EventBus(), dir, lastGood);
  assert.deepEqual(restarted.get().groups, ['Work']);
  assert.match(restarted.get().problem!, /not readable/);
  // Without a last good copy it still starts, on defaults.
  const fresh = new FileConfigStore(join(dir, 'cfg'), new EventBus(), dir);
  assert.deepEqual(fresh.get().groups, []);
});
