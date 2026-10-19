import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixture } from '../test/fixture.ts';
import { archiveName } from './releases.ts';
import { pemKeys, trustedKeys, verifyArchive } from './signing.ts';

function setup() {
  const f = makeFixture([{ version: '2026.10.1' }]);
  const rel = join(f.dir, '2026.10.1');
  const name = archiveName('2026.10.1');
  const read = () => ({
    archive: join(rel, name),
    name,
    sums: readFileSync(join(rel, 'SHA256SUMS')),
    signature: readFileSync(join(rel, 'SHA256SUMS.sig'), 'utf8'),
    keys: [f.publicPem],
  });
  return { f, rel, name, read };
}

test('a validly signed archive passes', async () => {
  const { read } = setup();
  await verifyArchive(read());
});

test('a tampered archive is refused', async () => {
  const { read } = setup();
  appendFileSync(read().archive, 'x');
  await assert.rejects(verifyArchive(read()), /does not match its SHA256SUMS entry/);
});

test('a tampered SHA256SUMS is refused', async () => {
  const { read } = setup();
  const opts = read();
  const sums = Buffer.from(opts.sums.toString().replace(/^./, (c) => (c === '0' ? '1' : '0')));
  await assert.rejects(verifyArchive({ ...opts, sums }), /not signed by a shub release key/);
});

test('a signature from another key is refused; an archive missing from SUMS too', async () => {
  const { read } = setup();
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  await assert.rejects(verifyArchive({ ...read(), keys: [other] }), /not signed/);
  await assert.rejects(verifyArchive({ ...read(), keys: [] }), /no release keys/);
  await assert.rejects(verifyArchive({ ...read(), name: archiveName('2026.10.1', 'linux-riscv') }), /not listed/);
});

test('trusted keys: the bundled ones plus those of the installed app version', () => {
  const bundled = trustedKeys(null);
  assert.equal(bundled.length, 1);
  assert.match(bundled[0], /^-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA/);
  const app = mkdtempSync(join(tmpdir(), 'shub-keys-'));
  const extra = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  writeFileSync(join(app, 'release-keys.pem'), `comment line\n${bundled[0]}\n\nnew key:\n${extra}`);
  assert.deepEqual(pemKeys(readFileSync(join(app, 'release-keys.pem'), 'utf8')).length, 2);
  assert.deepEqual(trustedKeys(app), [bundled[0], extra.trim()]);
});
