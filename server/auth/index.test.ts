import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config, Right } from '../../shared/api.ts';
import type { Context } from '../context.ts';
import { rightsFor } from '../permissions/rules.ts';
import type { Services } from '../services.ts';
import { openState } from '../state/index.ts';
import { AuthService } from './index.ts';

test('plugin rights are granted AND requested by the manifest', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'shub-auth-'));
  const granted: Right[] = ['read', 'buttons.write', 'sessions.start'];
  const services = {
    state: openState(stateDir),
    config: {
      get: () => ({ plugins: [{ name: 'demo', enabled: true, grantedRights: granted }] }) as unknown as Config,
    },
    permissions: { rightsFor },
    plugins: { requestedRights: (name: string) => (name === 'demo' ? ['read', 'sessions.start'] : []) },
  } as unknown as Services;
  const auth = new AuthService({ paths: { stateDir } } as Context, services);
  auth.init();
  const token = auth.issueClientToken({ kind: 'plugin', id: 'plugin:demo', rights: [] });
  const req = { headers: { authorization: `Bearer ${token}` } } as IncomingMessage;
  assert.deepEqual(auth.resolve(req)?.rights, ['read', 'sessions.start']);
  services.state.db.close();
  rmSync(stateDir, { recursive: true, force: true });
});
