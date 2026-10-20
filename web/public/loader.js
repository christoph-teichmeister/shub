// The app loader's checks (used by sw.js, tested in Node): is a machine's web bundle genuine, and which one is
// newest. A bundle is bundle.json (version, apiVersion, SHA-256 per file) from a shub release; another machine's
// bundle counts only when the release's SHA256SUMS, signed by a shub release key, lists that manifest.

/** Never part of a bundle: the loader itself comes only from the machine the app was installed from. */
export const LOADER_FILES = ['/sw.js', '/loader.js', '/release-keys.js', '/bundle.json'];

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Like launcher/src/releases.ts: 2026.10.3 > 2026.10.3-beta.9 > 2026.10.3-beta.2. */
export function compareVersions(a, b) {
  const pa = VERSION.exec(a);
  const pb = VERSION.exec(b);
  if (!pa || !pb) throw new Error(`not a version: ${pa ? b : a}`);
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) - Number(pb[i]);
  if (!pa[4] || !pb[4]) return (pa[4] ? -1 : 0) - (pb[4] ? -1 : 0);
  return pa[4].localeCompare(pb[4], 'en', { numeric: true });
}

/** "<sha256>  <name>" lines -> name -> sha256. */
export function parseSums(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line.trim());
    if (m) out.set(m[2], m[1]);
  }
  return out;
}

const bytes = (base64) => Uint8Array.from(atob(base64.trim()), (c) => c.charCodeAt(0));

export async function sha256hex(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signedBy(keys, message, signature) {
  for (const raw of keys) {
    const key = await crypto.subtle.importKey('raw', bytes(raw), { name: 'Ed25519' }, false, ['verify']);
    if (await crypto.subtle.verify('Ed25519', key, bytes(signature), new TextEncoder().encode(message))) return true;
  }
  return false;
}

/**
 * Checks what a machine offers at GET /api/bundle ({ name, manifest, sums?, signature? }) and returns the parsed
 * manifest, or throws why not. `trusted`: the install machine, whose own (also unsigned dev) builds always count.
 */
export async function verifyOffer(offer, keys, trusted) {
  if (!trusted) {
    if (!offer.sums || !offer.signature) throw new Error('not a signed release');
    if (!(await signedBy(keys, offer.sums, offer.signature))) throw new Error('SHA256SUMS is not signed by a shub key');
    const expected = parseSums(offer.sums).get(offer.name);
    if (!expected) throw new Error(`${offer.name} is not listed in SHA256SUMS`);
    if ((await sha256hex(offer.manifest)) !== expected) throw new Error('bundle.json does not match SHA256SUMS');
  }
  const manifest = JSON.parse(offer.manifest);
  if (!VERSION.test(manifest.version) || typeof manifest.files !== 'object' || !manifest.files['/index.html']) {
    throw new Error('not a shub bundle');
  }
  return manifest;
}

/** The candidate ({ origin, manifest }) with the highest version above `current`, or null. */
export function pickNewest(candidates, current) {
  let best = null;
  for (const c of candidates) {
    const base = best ? best.manifest.version : current;
    if (!base || compareVersions(c.manifest.version, base) > 0) best = c;
  }
  return best;
}
