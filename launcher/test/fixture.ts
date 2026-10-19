// Test helper: a local "GitHub release" directory (releases.json + archives + SHA256SUMS + signature) signed with a
// throwaway key, plus a tiny fake app in each archive. Point SHUB_TEST_RELEASES (or source()) at `url`.
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { archiveName } from '../src/releases.ts';

export interface FixtureRelease {
  version: string;
  prerelease?: boolean;
  notes?: string;
}

export interface Fixture {
  root: string;
  dir: string;
  url: string;
  privateKey: KeyObject;
  publicPem: string;
}

// Fake app: the server prints what it was started with; the CLI echoes its arguments as JSON.
const FAKE_MAIN = `console.log('fake server', JSON.stringify({ version: process.env.FAKE_VERSION, launcher: !!process.env.SHUB_LAUNCHER, home: process.env.SHUB_HOME }));\n`;
const FAKE_CLI = `console.log(JSON.stringify({ cli: process.argv.slice(2), launcher: !!process.env.SHUB_LAUNCHER }));\n`;

export function signSums(dir: string, privateKey: KeyObject): void {
  writeFileSync(
    join(dir, 'SHA256SUMS.sig'),
    sign(null, readFileSync(join(dir, 'SHA256SUMS')), privateKey).toString('base64'),
  );
}

export function makeFixture(releases: FixtureRelease[], platform = `${process.platform}-${process.arch}`): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'shub-launcher-test-'));
  process.once('exit', () => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'release');
  mkdirSync(dir);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  writeFileSync(join(dir, 'release-keys.pem'), publicPem);
  const url = pathToFileURL(dir).href + '/';
  const list = [];
  for (const r of releases) {
    // One folder per release, like GitHub's /releases/download/<tag>/ URLs.
    const rel = join(dir, r.version);
    const app = join(root, 'app', r.version);
    mkdirSync(join(app, 'server'), { recursive: true });
    mkdirSync(join(app, 'cli'), { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ version: r.version }));
    writeFileSync(
      join(app, 'server', 'main.ts'),
      FAKE_MAIN.replace('process.env.FAKE_VERSION', JSON.stringify(r.version)),
    );
    writeFileSync(join(app, 'cli', 'shub.ts'), FAKE_CLI);
    mkdirSync(rel);
    const name = archiveName(r.version, platform);
    execFileSync('tar', ['-czf', join(rel, name), '-C', app, '.']);
    const hash = createHash('sha256')
      .update(readFileSync(join(rel, name)))
      .digest('hex');
    writeFileSync(join(rel, 'SHA256SUMS'), `${hash}  ${name}\n`);
    signSums(rel, privateKey);
    list.push({
      tag_name: `v${r.version}`,
      draft: false,
      prerelease: !!r.prerelease,
      body: r.notes ?? `Notes for ${r.version}`,
      assets: [name, 'SHA256SUMS', 'SHA256SUMS.sig'].map((n) => ({
        name: n,
        browser_download_url: `${url}${r.version}/${n}`,
      })),
    });
  }
  writeFileSync(join(dir, 'releases.json'), JSON.stringify(list));
  return { root, dir, url, privateKey, publicPem };
}
