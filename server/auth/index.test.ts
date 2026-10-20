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

test('a phone pairs with its key, waits for approval and signs in with short-lived tokens', async () => {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const { challengeMessage } = await import('./index.ts');
  const stateDir = mkdtempSync(join(tmpdir(), 'shub-auth-'));
  const services = {
    state: openState(stateDir),
    config: { get: () => ({ plugins: [] }) as unknown as Config },
    permissions: { rightsFor },
  } as unknown as Services;
  const auth = new AuthService({ paths: { stateDir }, port: 4780, bus: { emit() {} } } as unknown as Context, services);
  auth.init();
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signNonce = (nonce: string) =>
    sign('sha256', Buffer.from(challengeMessage(nonce)), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
      'base64url',
    );
  const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as IncomingMessage;

  const { code } = await auth.startPairing();
  const device = auth.redeemPairing(code, 'Pixel', publicKey.export({ format: 'jwk' }));
  assert.equal(device.state, 'pending');
  assert.equal(device.level, 'prompts');
  assert.throws(() => auth.redeemPairing(code, 'again', publicKey.export({ format: 'jwk' })), /unknown or used/);
  assert.throws(() => auth.challenge(device.id), /waiting for approval/);

  auth.approve(device.id);
  const { nonce } = auth.challenge(device.id);
  assert.throws(() => auth.signIn(device.id, nonce, 'AAAA'), /bad signature/);
  // A nonce is single-use, even after a failed attempt.
  assert.throws(() => auth.signIn(device.id, nonce, signNonce(nonce)), /unknown or expired/);

  const second = auth.challenge(device.id).nonce;
  const { token } = auth.signIn(device.id, second, signNonce(second));
  const caller = auth.resolve(bearer(token));
  assert.equal(caller?.kind, 'user');
  assert.equal(caller?.deviceId, device.id);
  assert.equal(caller?.level, 'prompts');

  auth.setLevel(device.id, 'view');
  assert.equal(auth.resolve(bearer(token))?.level, 'view');

  auth.deleteDevice(device.id);
  assert.equal(auth.resolve(bearer(token)), null);
  services.state.db.close();
  rmSync(stateDir, { recursive: true, force: true });
});

test('pairing refuses anything but a P-256 public key', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'shub-auth-'));
  const services = {
    state: openState(stateDir),
    config: { get: () => ({ plugins: [] }) as unknown as Config },
    permissions: { rightsFor },
  } as unknown as Services;
  const auth = new AuthService({ paths: { stateDir }, port: 4780, bus: { emit() {} } } as unknown as Context, services);
  auth.init();
  const { code } = await auth.startPairing();
  assert.throws(() => auth.redeemPairing(code, 'x', undefined), /P-256/);
  assert.throws(() => auth.redeemPairing(code, 'x', { kty: 'EC', crv: 'P-256', x: 'a', y: 'b', d: 'c' }), /P-256/);
  services.state.db.close();
  rmSync(stateDir, { recursive: true, force: true });
});
