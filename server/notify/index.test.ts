import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EventBus, type Context } from '../context.ts';
import type { Services } from '../services.ts';
import { NotifyService } from './index.ts';

test('VAPID keys are generated once into a 0600 file', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'shub-notify-'));
  const ctx = { paths: { stateDir }, bus: new EventBus() } as unknown as Context;
  const db = new DatabaseSync(':memory:');
  const services = {
    state: { db, migrate: (_: string, s: string[]) => s.forEach((x) => db.exec(x)) },
  } as unknown as Services;
  const first = new NotifyService(ctx, services).publicKey;
  assert.equal(statSync(join(stateDir, 'vapid.json')).mode & 0o777, 0o600);
  assert.equal(new NotifyService(ctx, services).publicKey, first);
  rmSync(stateDir, { recursive: true, force: true });
});

test('forgetDevice drops only that device’s push subscriptions', () => {
  const db = new DatabaseSync(':memory:');
  const services = {
    state: { db, migrate: (_: string, s: string[]) => s.forEach((x) => db.exec(x)) },
  } as unknown as Services;
  db.exec('CREATE TABLE devices (id TEXT PRIMARY KEY, push INTEGER NOT NULL DEFAULT 0)');
  db.exec("INSERT INTO devices (id) VALUES ('phone'), ('desktop')");
  const notify = new NotifyService({ paths: {}, bus: new EventBus() } as unknown as Context, services);
  const sub = (n: number) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'k', auth: 'a' } });
  notify.subscribe(sub(1), 'phone');
  notify.subscribe(sub(2), 'desktop');
  notify.forgetDevice('phone');
  const rows = db.prepare('SELECT device_id FROM push_subscriptions').all() as { device_id: string }[];
  assert.deepEqual(
    rows.map((r) => r.device_id),
    ['desktop'],
  );
  assert.equal((db.prepare("SELECT push FROM devices WHERE id = 'desktop'").get() as { push: number }).push, 1);
});
