import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
// @ts-expect-error plain JS module shared with the service worker
import { compareVersions, parseSums, pickNewest, verifyOffer } from '../web/public/loader.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const KEYS = [publicKey.export({ format: 'jwk' }).x!.replace(/-/g, '+').replace(/_/g, '/') + '='];

function offer(version: string, opts: { tamper?: boolean; unsigned?: boolean; name?: string } = {}) {
  const manifest = JSON.stringify({ version, apiVersion: 1, files: { '/index.html': 'a'.repeat(64) } });
  const name = `shub-${version}-linux-x64.bundle.json`;
  const sums = `${createHash('sha256').update(manifest).digest('hex')}  ${name}\n`;
  const signature = sign(null, Buffer.from(sums), privateKey).toString('base64');
  return {
    name: opts.name ?? name,
    manifest: opts.tamper ? manifest.replace('"apiVersion":1', '"apiVersion":2') : manifest,
    ...(opts.unsigned ? {} : { sums, signature }),
  };
}

test('versions compare like the launcher', () => {
  assert.ok(compareVersions('2026.10.3', '2026.10.3-beta.9') > 0);
  assert.ok(compareVersions('2026.10.3-beta.10', '2026.10.3-beta.2') > 0);
  assert.ok(compareVersions('2026.11.0', '2026.10.30') > 0);
});

test('SHA256SUMS lines parse to name -> hash', () => {
  assert.equal(parseSums(`${'b'.repeat(64)}  shub.tar.gz\nnoise\n`).get('shub.tar.gz'), 'b'.repeat(64));
});

test("another machine's bundle counts only when signed and listed", async () => {
  assert.equal((await verifyOffer(offer('2026.10.4'), KEYS, false)).version, '2026.10.4');
  await assert.rejects(verifyOffer(offer('2026.10.4', { tamper: true }), KEYS, false), /does not match/);
  await assert.rejects(verifyOffer(offer('2026.10.4', { unsigned: true }), KEYS, false), /not a signed release/);
  await assert.rejects(verifyOffer(offer('2026.10.4', { name: 'other.json' }), KEYS, false), /not listed/);
  const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x!;
  await assert.rejects(
    verifyOffer(offer('2026.10.4'), [other.replace(/-/g, '+').replace(/_/g, '/') + '='], false),
    /not signed by a shub key/,
  );
});

test("the install machine's own bundle counts unsigned (dev builds)", async () => {
  assert.equal((await verifyOffer(offer('2026.10.4', { unsigned: true }), KEYS, true)).version, '2026.10.4');
});

test('the newest bundle above the current one wins', () => {
  const at = (origin: string, version: string) => ({ origin, manifest: { version } });
  assert.equal(pickNewest([at('a', '2026.10.4'), at('b', '2026.10.5-beta.1')], '2026.10.3')?.origin, 'b');
  assert.equal(pickNewest([at('a', '2026.10.3')], '2026.10.3'), null);
  assert.equal(pickNewest([at('a', '2026.10.1')], undefined)?.origin, 'a');
});

test('canReloadNow: unsent text always waits, terminal use waits unless hidden', async () => {
  const { canReloadNow } = await import('../web/src/lib/stores/loader.ts');
  const idle = { unsentText: false, hidden: false, terminalIdleMs: 60_000 };
  assert.equal(canReloadNow(idle), true);
  assert.equal(canReloadNow({ ...idle, unsentText: true }), false);
  assert.equal(canReloadNow({ ...idle, unsentText: true, hidden: true }), false);
  assert.equal(canReloadNow({ ...idle, terminalIdleMs: 2000 }), false);
  assert.equal(canReloadNow({ ...idle, terminalIdleMs: 2000, hidden: true }), true);
});

test('every self-hosted font that fonts.css or index.html names exists in web/public/fonts', () => {
  const css = readFileSync('web/src/lib/tokens/fonts.css', 'utf8');
  const html = readFileSync('web/index.html', 'utf8');
  const urls = [...css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g), ...html.matchAll(/rel="preload" href="([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.ok(urls.length > 0);
  for (const u of urls) assert.ok(existsSync('web/public' + u.replace(/^.*?(\/fonts\/)/, '$1')), u);
});
