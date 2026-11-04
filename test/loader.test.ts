import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

test('a check for other machines waits for a check of this one in flight instead of taking its answer', async () => {
  // sw.js imports the built release-keys.js: load a copy next to a stub of it, in a service worker's globals.
  const dir = mkdtempSync(join(tmpdir(), 'shub-sw-'));
  for (const f of ['sw.js', 'loader.js']) copyFileSync(join('web/public', f), join(dir, f));
  writeFileSync(join(dir, 'release-keys.js'), 'export const RELEASE_KEYS = [];\n');
  const on: Record<string, (e: unknown) => void> = {};
  const asked: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  Object.assign(globalThis, {
    self: { addEventListener: (type: string, fn: (e: unknown) => void) => (on[type] = fn) },
    location: { origin: 'https://pc' },
    caches: { open: async () => ({ match: async () => undefined }) },
    fetch: async (url: string) => {
      asked.push(url);
      if (asked.length === 1) await held; // the page load's check of this machine is still running
      return { ok: false, status: 404 };
    },
  });
  await import(pathToFileURL(join(dir, 'sw.js')).href);
  const done: Promise<unknown>[] = [];
  const check = (origins: string[]) =>
    on.message({
      data: { type: 'update-check', origins },
      ports: [{ postMessage() {} }],
      waitUntil: (p: Promise<unknown>) => done.push(p),
    });
  check([]);
  check(['https://laptop']);
  release();
  await Promise.all(done);
  assert.deepEqual(asked, ['https://pc/api/bundle', 'https://pc/api/bundle', 'https://laptop/api/bundle']);
});
