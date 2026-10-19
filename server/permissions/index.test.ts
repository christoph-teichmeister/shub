import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { Approval, Config, Project, ServerEvent } from '../../shared/api.ts';
import { EventBus, type Context } from '../context.ts';
import type { Services } from '../services.ts';
import { create } from './index.ts';

function setup() {
  const db = new DatabaseSync(':memory:');
  const project: Project = {
    id: 'p1',
    name: 'One',
    path: '/tmp/one',
    group: 'g',
    visibility: 'pinned',
    order: 0,
    icon: { kind: 'auto' },
    buttons: [{ id: 'b1', label: 'Go', prompt: 'go', ask: 'nothing', confirm: false }],
  };
  const config = { projects: [project] } as Config;
  const notified: Approval[] = [];
  const services = {
    state: { db, migrate: (_: string, statements: string[]) => statements.forEach((s) => db.exec(s)) },
    config: {
      get: () => config,
      update: (mutate: (c: Config) => void) => (mutate(config), config),
      project: (id: string) => config.projects.find((p) => p.id === id),
    },
    notify: { approval: (a: Approval) => notified.push(a) },
  } as unknown as Services;
  const ctx = { bus: new EventBus() } as Context;
  const events: ServerEvent[] = [];
  ctx.bus.on((e) => events.push(e));
  const { service } = create(ctx, services);
  return { service, config, events, notified };
}

const input = {
  requestedBy: 'session:s1',
  action: 'session.start' as const,
  projectId: 'p1',
  summary: 'start',
  detail: 'prompt',
};

test('approval lifecycle: created, notified, decided, waiters resolved', async () => {
  const { service, events, notified } = setup();
  const a = service.requestApproval(input);
  assert.equal(a.state, 'pending');
  assert.equal(notified.length, 1);
  assert.equal(events[0].type, 'approval.created');
  const waiting = service.waitForDecision(a.id);
  assert.equal(service.decideApproval(a.id, true).state, 'approved');
  assert.equal(await waiting, true);
  assert.equal(events.at(-1)?.type, 'approval.decided');
  assert.throws(() => service.decideApproval(a.id, false), /already approved/);
  assert.equal(await service.waitForDecision(a.id), true, 'already decided resolves at once');
});

test('approval times out as rejected', async () => {
  const { service } = setup();
  const a = service.requestApproval(input);
  assert.equal(await service.waitForDecision(a.id, 10), false);
  assert.equal(service.approvals()[0].state, 'rejected');
});

test('decide counts automatic starts and asks after the limit', () => {
  const { service } = setup();
  const g = { kind: 'global-claude' as const, id: 'session:g', rights: service.rightsFor('global-claude') };
  const action = {
    kind: 'session.start' as const,
    request: { projectId: 'p1', kind: 'claude' as const, buttonId: 'b1' },
    viaButton: true,
    simpleInput: true,
  };
  const outcomes = Array.from({ length: 6 }, () => service.decide(g, action).outcome);
  assert.deepEqual(outcomes, ['allow', 'allow', 'allow', 'allow', 'allow', 'ask']);
  const user = { kind: 'user' as const, id: 'chris', rights: service.rightsFor('user') };
  assert.equal(service.decide(user, action).outcome, 'allow');
});

test('activity log newest first with limit', () => {
  const { service, events } = setup();
  for (const n of [1, 2, 3]) service.log({ actor: 'chris', action: 'x', detail: String(n) });
  assert.deepEqual(
    service.activity(2).map((e) => e.detail),
    ['3', '2'],
  );
  assert.equal(events.filter((e) => e.type === 'activity').length, 3);
});

test('undo project.add removes the project, once', () => {
  const { service, config } = setup();
  const e = service.log({
    actor: 'session:g',
    action: 'project.add',
    detail: 'One',
    undo: { kind: 'project.add', payload: { projectId: 'p1' } },
  });
  service.undo(e.id, 'chris');
  assert.equal(config.projects.length, 0);
  assert.throws(() => service.undo(e.id, 'chris'), /nothing to undo/);
  assert.equal(service.activity(1)[0].action, 'undo');
});

test('undo project.update restores previous fields', () => {
  const { service, config } = setup();
  config.projects[0].name = 'Renamed';
  const e = service.log({
    actor: 'session:g',
    action: 'project.update',
    detail: 'name',
    undo: { kind: 'project.update', payload: { projectId: 'p1', previous: { name: 'One', id: 'evil' } } },
  });
  service.undo(e.id, 'chris');
  assert.equal(config.projects[0].name, 'One');
  assert.equal(config.projects[0].id, 'p1');
});
