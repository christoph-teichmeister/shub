// GET /api/bundle: what a phone app's loader (web/public/sw.js) needs to take this machine's web app:
// web/dist/bundle.json (written by the release, absent in dev builds) plus the release's SHA256SUMS and its
// signature, which list that manifest. shub never keeps those after installing, so they are fetched once from
// the GitHub release and cached in <stateDir>/release/<version>/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleName } from '../../launcher/src/releases.ts';
import { HttpError } from './router.ts';

const DOWNLOAD = 'https://github.com/christoph-teichmeister/shub/releases/download';

export interface BundleOffer {
  name: string;
  manifest: string;
  sums?: string;
  signature?: string;
}

async function releaseFile(stateDir: string, version: string, file: string): Promise<string | undefined> {
  const dir = join(stateDir, 'release', version);
  const cached = join(dir, file);
  if (existsSync(cached)) return readFileSync(cached, 'utf8');
  const res = await fetch(`${DOWNLOAD}/v${version}/${file}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res?.ok) return undefined;
  const text = await res.text();
  mkdirSync(dir, { recursive: true });
  writeFileSync(cached, text);
  return text;
}

export async function bundleOffer(distDir: string, stateDir: string): Promise<BundleOffer> {
  const file = join(distDir, 'bundle.json');
  if (!existsSync(file)) throw new HttpError(404, 'no bundle.json: not a release build');
  const manifest = readFileSync(file, 'utf8');
  const { version } = JSON.parse(manifest) as { version: string };
  const [sums, signature] = await Promise.all([
    releaseFile(stateDir, version, 'SHA256SUMS'),
    releaseFile(stateDir, version, 'SHA256SUMS.sig'),
  ]);
  return { name: bundleName(version), manifest, ...(sums && signature ? { sums, signature } : {}) };
}
