import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '../../shared/api.ts';
import { refuseLevel, routeLevel } from './levels.ts';

test('GET needs view, writes need control, listed routes their own level', () => {
  assert.equal(routeLevel(ROUTES.sessions), 'view');
  assert.equal(routeLevel(ROUTES.sessionStart), 'control');
  assert.equal(routeLevel(ROUTES.sessionPaste), 'control');
  assert.equal(routeLevel(ROUTES.approvalDecide), 'prompts');
  assert.equal(routeLevel(ROUTES.pushSubscribe), 'view');
});

test('the gate lets each level through up to its own', () => {
  assert.equal(refuseLevel(undefined, ROUTES.sessionStart), null);
  assert.equal(refuseLevel('view', ROUTES.sessions), null);
  assert.match(refuseLevel('view', ROUTES.approvalDecide) ?? '', /only view/);
  assert.equal(refuseLevel('prompts', ROUTES.approvalDecide), null);
  assert.equal(refuseLevel('prompts', ROUTES.sessionKeys), null);
  // A browser just approved at Prompts must reach the join routes (their own mark is the gate).
  assert.equal(refuseLevel('prompts', ROUTES.groupJoinOffer), null);
  assert.equal(refuseLevel('prompts', ROUTES.groupJoin), null);
  assert.match(refuseLevel('prompts', ROUTES.sessionStart) ?? '', /only answer prompts/);
  assert.match(refuseLevel('prompts', ROUTES.deviceUpdate) ?? '', /control/);
  assert.equal(refuseLevel('control', ROUTES.sessionStart), null);
});
