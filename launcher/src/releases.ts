// Where releases come from: the GitHub releases of christoph-teichmeister/shub, nothing else.
// Tests point SHUB_TEST_RELEASES at a local fixture (file:// or http://127.0.0.1) with its own release-keys.pem.
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pemKeys } from './signing.ts';

export const REPO = 'christoph-teichmeister/shub';
const API_URL = `https://api.github.com/repos/${REPO}/releases?per_page=50`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;

export type Channel = 'stable' | 'beta';

/** The fields of a GitHub API release that shub reads. */
export interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  body?: string | null;
  assets: { name: string; browser_download_url: string }[];
}

export interface Release {
  version: string;
  prerelease: boolean;
  notes: string;
  /** Asset name -> download URL. */
  assets: Map<string, string>;
}

export interface Source {
  releases(): Promise<Release[]>;
  /** Fetch `url` (one of a release's asset URLs) into `dest`. */
  download(url: string, dest: string): Promise<void>;
  /** Keys of a test fixture; null means the real release keys. */
  testKeys(): Promise<string[] | null>;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export const isVersion = (v: string): boolean => VERSION.test(v);

/** Semver order, which CalVer `YYYY.M.MICRO[-beta.N]` follows: a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const pa = VERSION.exec(a);
  const pb = VERSION.exec(b);
  if (!pa || !pb) throw new Error(`not a version: ${pa ? b : a}`);
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) - Number(pb[i]);
  if (!pa[4] || !pb[4]) return (pa[4] ? -1 : 0) - (pb[4] ? -1 : 0);
  return pa[4].localeCompare(pb[4], 'en', { numeric: true }); // beta.2 < beta.10
}

/** Published releases with a version tag, newest first. */
export function parseReleases(list: GitHubRelease[]): Release[] {
  return list
    .filter((r) => !r.draft && isVersion(r.tag_name.replace(/^v/, '')))
    .map((r) => ({
      version: r.tag_name.replace(/^v/, ''),
      prerelease: r.prerelease,
      notes: r.body ?? '',
      assets: new Map(r.assets.map((a) => [a.name, a.browser_download_url])),
    }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** stable: the newest non-prerelease; beta: the newest of all. */
export function latest(releases: Release[], channel: Channel): Release | null {
  return releases.find((r) => channel === 'beta' || !r.prerelease) ?? null;
}

/** Notes of every release on the channel after `from` up to and including `to`, newest first. */
export function changelog(releases: Release[], channel: Channel, from: string | null, to: string): string {
  return releases
    .filter((r) => (channel === 'beta' || !r.prerelease) && compareVersions(r.version, to) <= 0)
    .filter((r) => !from || compareVersions(r.version, from) > 0)
    .map((r) => `## ${r.version}\n\n${r.notes.trim()}`)
    .join('\n\n');
}

export const archiveName = (version: string, platform = `${process.platform}-${process.arch}`): string =>
  `shub-${version}-${platform}.tar.gz`;

async function get(url: string): Promise<Buffer> {
  if (url.startsWith('file:')) return readFile(fileURLToPath(url));
  const res = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'shub-launcher' } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The real GitHub source, or the local fixture named by SHUB_TEST_RELEASES (tests only). */
export function source(env: NodeJS.ProcessEnv = process.env): Source {
  const test = env.SHUB_TEST_RELEASES;
  if (test && !/^(file:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(test)) {
    throw new Error('SHUB_TEST_RELEASES must be a file:// or http://127.0.0.1 URL');
  }
  const base = test ? (test.endsWith('/') ? test : `${test}/`) : null;
  const prefix = base ?? DOWNLOAD_PREFIX;
  return {
    async releases() {
      const list = JSON.parse((await get(base ? `${base}releases.json` : API_URL)).toString('utf8'));
      return parseReleases(list as GitHubRelease[]);
    },
    async download(url, dest) {
      if (!url.startsWith(prefix)) throw new Error(`refusing to download from ${url}: not under ${prefix}`);
      if (url.startsWith('file:')) return copyFile(fileURLToPath(url), dest);
      await writeFile(dest, await get(url));
    },
    async testKeys() {
      return base ? pemKeys((await get(`${base}release-keys.pem`)).toString('utf8')) : null;
    },
  };
}
