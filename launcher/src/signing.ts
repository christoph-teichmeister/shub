// Release integrity: SHA256SUMS lists the archives, SHA256SUMS.sig is an ed25519 signature of it (base64).
// An archive is installed only if its hash is in a SHA256SUMS that one of the trusted keys signed.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The PEM public key blocks in a text (release-keys.pem allows comment lines around them). */
export function pemKeys(text: string): string[] {
  return text.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g) ?? [];
}

function readKeys(file: string | URL): string[] {
  try {
    return pemKeys(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Keys shipped with this launcher plus the ones in the installed app version, so a release signed with the old
 * key can introduce a new one (docs/RELEASING.md).
 */
export function trustedKeys(currentDir: string | null): string[] {
  const bundled = readKeys(new URL('../release-keys.pem', import.meta.url));
  return [...new Set([...bundled, ...(currentDir ? readKeys(join(currentDir, 'release-keys.pem')) : [])])];
}

export function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/** `sha256sum` format: "<hex>  <name>" per line. */
export function parseSums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (m) sums.set(m[2], m[1]);
  }
  return sums;
}

export function signatureValid(sums: Buffer, signatureBase64: string, keys: string[]): boolean {
  const signature = Buffer.from(signatureBase64.trim(), 'base64');
  return keys.some((pem) => {
    try {
      return verify(null, sums, createPublicKey(pem), signature);
    } catch {
      return false;
    }
  });
}

/** Throws unless `archive` (published as `name`) is listed with its hash in a validly signed SHA256SUMS. */
export async function verifyArchive(opts: {
  archive: string;
  name: string;
  sums: Buffer;
  signature: string;
  keys: string[];
}): Promise<void> {
  if (!opts.keys.length) throw new Error('no release keys to verify with');
  if (!signatureValid(opts.sums, opts.signature, opts.keys)) {
    throw new Error('SHA256SUMS is not signed by a shub release key; refusing to install');
  }
  const expected = parseSums(opts.sums.toString('utf8')).get(opts.name);
  if (!expected) throw new Error(`${opts.name} is not listed in SHA256SUMS; refusing to install`);
  if ((await sha256(opts.archive)) !== expected) {
    throw new Error(`${opts.name} does not match its SHA256SUMS entry; refusing to install`);
  }
}
