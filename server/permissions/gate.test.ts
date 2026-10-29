import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Decision } from '../../shared/api.ts';
import type { Caller } from '../api/router.ts';
import type { PermissionAction, Permissions } from '../services.ts';
import { approvalGate } from './gate.ts';

const caller = { kind: 'session', id: 'session:s1', rights: [] } as Caller;
const action = { kind: 'projects.write', projectId: null } as PermissionAction;

function permissions(decisions: Decision[], approve: boolean) {
  const requested: object[] = [];
  const perms = {
    decide: () => decisions.shift()!,
    requestApproval: (input: object) => (
      requested.push(input),
      { ...input, id: 'a1', createdAt: '', state: 'pending' }
    ),
    waitForDecision: async () => approve,
  } as unknown as Permissions;
  return { perms, requested };
}

const info = (reason: string) => ({ action: 'projects.write' as const, projectId: null, summary: reason, detail: '' });

test('approvalGate: deny wins, all-allow goes ahead, ask runs the change only once approved', async () => {
  const deny = permissions(
    [
      { outcome: 'ask', reason: 'a' },
      { outcome: 'deny', reason: 'no' },
    ],
    true,
  );
  assert.throws(() => approvalGate(deny.perms, caller, [action, action], info, () => {}), { status: 403 });
  assert.equal(deny.requested.length, 0);

  const allow = permissions([{ outcome: 'allow' }], true);
  assert.equal(
    approvalGate(allow.perms, caller, [action], info, () => assert.fail()),
    null,
  );

  for (const approve of [true, false]) {
    let ran = false;
    const ask = permissions([{ outcome: 'allow' }, { outcome: 'ask', reason: 'needs your OK' }], approve);
    const approval = approvalGate(ask.perms, caller, [action, action], info, () => (ran = true));
    assert.equal(approval?.id, 'a1');
    assert.deepEqual(ask.requested, [{ requestedBy: 'session:s1', ...info('needs your OK') }]);
    await new Promise((r) => setImmediate(r));
    assert.equal(ran, approve);
  }
});
