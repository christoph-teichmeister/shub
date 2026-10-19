import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerEvent } from '../../shared/api.ts';
import { EventBus } from '../context.ts';
import { DEFAULT_ACCENT, FileConfigStore, hostOfRemote, iconForHost } from './index.ts';

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
  assert.equal(store.projectView('sym')!.accent, '#a6e22e');
  assert.equal(store.projectView('orange')!.accent, DEFAULT_ACCENT);
  assert.equal(store.projectView('plain')!.resolvedIcon.kind, 'none');
});
