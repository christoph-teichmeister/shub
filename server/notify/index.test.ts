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
