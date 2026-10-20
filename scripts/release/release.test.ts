import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signatureValid, verifyArchive } from '../../launcher/src/signing.ts';
import { bundleManifest, changelogFrom, isChannelTag, nextVersion, signDir } from './release.ts';
// @ts-expect-error plain JS module shared with the service worker
import { verifyOffer } from '../../web/public/loader.js';

const OCT = new Date('2026-10-19T12:00:00Z');

test('stable: next free MICRO of this month; beta: next stable plus -beta.N', () => {
  assert.equal(nextVersion([], 'stable', OCT), '2026.10.0');
  assert.equal(nextVersion([], 'beta', OCT), '2026.10.0-beta.1');
  const tags = [
    'v2026.9.4',
    'v2026.10.0',
    'v2026.10.1',
    'v2026.10.2-beta.1',
    'v2026.10.2-beta.2',
    'v2026.10.10-beta.1',
  ];
  assert.equal(nextVersion(tags, 'stable', OCT), '2026.10.2');
  assert.equal(nextVersion(tags, 'beta', OCT), '2026.10.2-beta.3');
  assert.equal(nextVersion([...tags, 'v2026.10.2'], 'beta', OCT), '2026.10.3-beta.1');
  assert.equal(nextVersion(tags, 'stable', new Date('2026-11-01T00:00:00Z')), '2026.11.0');
  assert.equal(nextVersion(['v2026.10.9'], 'stable', OCT), '2026.10.10', 'numbers, not strings');
  assert.ok(isChannelTag('v2026.10.0', 'stable') && !isChannelTag('v2026.10.0-beta.1', 'stable'));
  assert.ok(isChannelTag('v2026.10.0-beta.1', 'beta') && !isChannelTag('v2026.10.0', 'beta'));
});

test('changelog groups Conventional Commits', () => {
  const notes = changelogFrom([
    { subject: 'feat(launcher): add shub doctor', body: '' },
    { subject: 'fix: keep tmux alive on restart', body: '' },
    { subject: 'feat!: drop Node 22', body: '' },
    { subject: 'refactor(api): split router', body: 'BREAKING CHANGE: routes moved' },
    { subject: 'docs: releasing guide', body: '' },
    { subject: 'Keep sessions across restarts', body: '' },
  ]);
  assert.equal(
    notes,
    [
      '### Breaking changes\n\n- drop Node 22\n- api: split router',
      '### Features\n\n- launcher: add shub doctor',
      '### Fixes\n\n- keep tmux alive on restart',
      '### Other\n\n- releasing guide\n- Keep sessions across restarts',
    ].join('\n\n'),
  );
  assert.equal(changelogFrom([]), 'No changes.');
});

test('signing writes SHA256SUMS and a signature the launcher accepts, only with a trusted key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shub-sign-'));
  writeFileSync(join(dir, 'shub-2026.10.0-linux-x64.tar.gz'), 'archive');
  writeFileSync(join(dir, 'shub-2026.10.0-darwin-arm64.tar.gz'), 'other archive');
  const key = generateKeyPairSync('ed25519');
  const privatePem = key.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = key.publicKey.export({ type: 'spki', format: 'pem' }).toString().trim();
  await assert.rejects(signDir(dir, privatePem, []), /not in .*release-keys\.pem/);

  const sums = await signDir(dir, privatePem, [publicPem]);
  assert.match(
    sums,
    /^[0-9a-f]{64} {2}shub-2026\.10\.0-darwin-arm64\.tar\.gz\n[0-9a-f]{64} {2}shub-2026\.10\.0-linux-x64\.tar\.gz\n$/,
  );
  const signature = readFileSync(join(dir, 'SHA256SUMS.sig'), 'utf8');
  assert.ok(signatureValid(readFileSync(join(dir, 'SHA256SUMS')), signature, [publicPem]));
  await verifyArchive({
    archive: join(dir, 'shub-2026.10.0-linux-x64.tar.gz'),
    name: 'shub-2026.10.0-linux-x64.tar.gz',
    sums: readFileSync(join(dir, 'SHA256SUMS')),
    signature,
    keys: [publicPem],
  });
});

test('the bundle manifest lists every web file but the loader, and a phone accepts it once SHA256SUMS is signed', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'shub-dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(dist, 'sw.js'), 'loader');
  writeFileSync(join(dist, 'release-keys.js'), 'keys');
  const manifest = bundleManifest(dist, '2026.10.4');
  const parsed = JSON.parse(manifest);
  assert.deepEqual(Object.keys(parsed.files), ['/assets/app.js', '/index.html']);
  assert.equal(parsed.files['/index.html'], createHash('sha256').update('<!doctype html>').digest('hex'));

  const dir = mkdtempSync(join(tmpdir(), 'shub-sign-'));
  const name = 'shub-2026.10.4-linux-x64.bundle.json';
  writeFileSync(join(dir, 'shub-2026.10.4-linux-x64.tar.gz'), 'archive');
  writeFileSync(join(dir, name), manifest);
  const key = generateKeyPairSync('ed25519');
  const publicPem = key.publicKey.export({ type: 'spki', format: 'pem' }).toString().trim();
  const sums = await signDir(dir, key.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), [publicPem]);
  assert.match(sums, new RegExp(`  ${name.replace(/\./g, '\\.')}\n`));
  const raw = Buffer.from(key.publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64');
  const signature = readFileSync(join(dir, 'SHA256SUMS.sig'), 'utf8');
  const accepted = await verifyOffer({ name, manifest, sums, signature }, [raw], false);
  assert.equal(accepted.version, '2026.10.4');
});
