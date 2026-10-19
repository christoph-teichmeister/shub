// Release tooling, used by .github/workflows/release.yml and runnable locally (docs/RELEASING.md):
//   node scripts/release/release.ts version --branch main|develop [--sha <sha>]   -> version=..., channel=... lines
//   node scripts/release/release.ts pack --version <v> --out <dir>                -> archive for this platform
//   node scripts/release/release.ts sign <dir> [--keys <pem file>]                -> SHA256SUMS + SHA256SUMS.sig
//   node scripts/release/release.ts changelog --channel stable|beta [--sha <sha>] -> Markdown release notes
// sign reads the private key (PEM) from SHUB_RELEASE_SIGNING_KEY and never writes it to disk.
import { execFileSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { archiveName, type Channel } from '../../launcher/src/releases.ts';
import { pemKeys, sha256, signatureValid } from '../../launcher/src/signing.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
/** The one list of release public keys, shipped in the launcher and in every app archive. */
export const KEYS_FILE = join(ROOT, 'launcher', 'release-keys.pem');

const escape = (s: string) => s.replace(/\./g, '\\.');

/**
 * stable: YYYY.M.MICRO with MICRO the next free number for this month among stable tags.
 * beta: the next stable version plus -beta.N, N counting up.
 */
export function nextVersion(tags: string[], channel: Channel, now: Date): string {
  const month = `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}`;
  const micros = tags
    .map((t) => new RegExp(`^v${escape(month)}\\.(\\d+)$`).exec(t)?.[1])
    .filter((m) => m !== undefined);
  const stable = `${month}.${micros.length ? Math.max(...micros.map(Number)) + 1 : 0}`;
  if (channel === 'stable') return stable;
  const betas = tags
    .map((t) => new RegExp(`^v${escape(stable)}-beta\\.(\\d+)$`).exec(t)?.[1])
    .filter((n) => n !== undefined);
  return `${stable}-beta.${betas.length ? Math.max(...betas.map(Number)) + 1 : 1}`;
}

export const isChannelTag = (tag: string, channel: Channel): boolean =>
  channel === 'stable' ? /^v\d+\.\d+\.\d+$/.test(tag) : /^v\d+\.\d+\.\d+-beta\.\d+$/.test(tag);

const GROUPS: [string, string[]][] = [
  ['Features', ['feat']],
  ['Fixes', ['fix', 'perf']],
];

/** Release notes from Conventional Commit messages: breaking changes, features, fixes, everything else. */
export function changelogFrom(commits: { subject: string; body: string }[]): string {
  const sections = new Map<string, string[]>([
    ['Breaking changes', []],
    ...GROUPS.map(([t]) => [t, []] as [string, string[]]),
    ['Other', []],
  ]);
  for (const { subject, body } of commits) {
    const m = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/.exec(subject);
    const line = m ? `- ${m[2] ? `${m[2]}: ` : ''}${m[4]}` : `- ${subject}`;
    if (m && (m[3] || /^BREAKING[ -]CHANGE:/m.test(body))) sections.get('Breaking changes')!.push(line);
    else sections.get(GROUPS.find(([, types]) => m && types.includes(m[1]))?.[0] ?? 'Other')!.push(line);
  }
  const out = [...sections]
    .filter(([, lines]) => lines.length)
    .map(([title, lines]) => `### ${title}\n\n${lines.join('\n')}`);
  return out.join('\n\n') || 'No changes.';
}

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const tags = () => git('tag', '--list', 'v*').split('\n').filter(Boolean);

function changelog(channel: Channel, sha: string): string {
  // Newest tag of the channel that is an ancestor of sha.
  const previous = git('tag', '--list', 'v*', '--merged', sha, '--sort=-v:refname')
    .split('\n')
    .find((t) => isChannelTag(t, channel));
  const log = git('log', '--no-merges', '--format=%s%x1f%b%x1e', previous ? `${previous}..${sha}` : sha);
  const commits = log
    .split('\x1e')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [subject, body = ''] = c.split('\x1f');
      return { subject, body };
    });
  return `${changelogFrom(commits)}\n\n${previous ? `Changes since ${previous}.` : 'First release.'}\n`;
}

/** Archive for this platform: server, shared, cli, built web app, package.json and production node_modules. */
export function pack(version: string, outDir: string): string {
  if (!existsSync(join(ROOT, 'web', 'dist', 'index.html'))) throw new Error('web/dist is missing: run npm run build');
  const stage = mkdtempSync(join(tmpdir(), 'shub-pack-'));
  try {
    const notTest = (src: string) => !src.endsWith('.test.ts');
    for (const dir of ['server', 'shared', 'cli'])
      cpSync(join(ROOT, dir), join(stage, dir), { recursive: true, filter: notTest });
    cpSync(join(ROOT, 'web', 'dist'), join(stage, 'web', 'dist'), { recursive: true });
    cpSync(KEYS_FILE, join(stage, 'release-keys.pem'));
    cpSync(join(ROOT, 'package-lock.json'), join(stage, 'package-lock.json'));
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    writeFileSync(join(stage, 'package.json'), JSON.stringify({ ...pkg, version }, null, 2) + '\n');
    // The installed node_modules carry node-pty built for this platform; drop the dev dependencies.
    cpSync(join(ROOT, 'node_modules'), join(stage, 'node_modules'), { recursive: true, verbatimSymlinks: true });
    execFileSync('npm', ['prune', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], {
      cwd: stage,
      stdio: 'ignore',
    });
    mkdirSync(outDir, { recursive: true });
    const archive = join(outDir, archiveName(version));
    // COPYFILE_DISABLE: no macOS ._ resource files in the archive.
    execFileSync('tar', ['-czf', archive, '-C', stage, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    return archive;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** Writes SHA256SUMS over the archives in dir and signs it; the key must be one of `trusted`. */
export async function signDir(dir: string, privatePem: string, trusted: string[]): Promise<string> {
  const key = createPrivateKey(privatePem);
  const publicPem = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString().trim();
  if (!trusted.includes(publicPem)) {
    throw new Error(`the signing key's public key is not in ${KEYS_FILE}; installs would refuse this release`);
  }
  const archives = readdirSync(dir)
    .filter((f) => f.endsWith('.tar.gz'))
    .sort();
  if (!archives.length) throw new Error(`no archives in ${dir}`);
  const sums = (await Promise.all(archives.map(async (a) => `${await sha256(join(dir, a))}  ${a}\n`))).join('');
  const signature = sign(null, Buffer.from(sums), key).toString('base64');
  if (!signatureValid(Buffer.from(sums), signature, trusted)) throw new Error('signature does not verify');
  writeFileSync(join(dir, 'SHA256SUMS'), sums);
  writeFileSync(join(dir, 'SHA256SUMS.sig'), signature + '\n');
  return sums;
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      branch: { type: 'string' },
      sha: { type: 'string', default: 'HEAD' },
      version: { type: 'string' },
      out: { type: 'string' },
      keys: { type: 'string' },
      channel: { type: 'string' },
    },
  });
  const [command, dir] = positionals;
  const channelOf = (v?: string): Channel => {
    if (v === 'stable' || v === 'beta') return v;
    throw new Error('--channel must be stable or beta');
  };
  if (command === 'version') {
    if (values.branch !== 'main' && values.branch !== 'develop') throw new Error('--branch must be main or develop');
    const channel: Channel = values.branch === 'main' ? 'stable' : 'beta';
    // A re-run for a commit that already has its release must not cut another one.
    const done = git('tag', '--points-at', values.sha)
      .split('\n')
      .some((t) => isChannelTag(t, channel));
    console.log(`channel=${channel}\nversion=${done ? '' : nextVersion(tags(), channel, new Date())}`);
  } else if (command === 'pack') {
    if (!values.version || !values.out) throw new Error('pack needs --version and --out');
    console.log(pack(values.version, values.out));
  } else if (command === 'sign') {
    const key = process.env.SHUB_RELEASE_SIGNING_KEY;
    if (!dir || !key) throw new Error('sign needs a folder and SHUB_RELEASE_SIGNING_KEY');
    process.stdout.write(await signDir(dir, key, pemKeys(readFileSync(values.keys ?? KEYS_FILE, 'utf8'))));
  } else if (command === 'changelog') {
    process.stdout.write(changelog(channelOf(values.channel), values.sha));
  } else {
    throw new Error('usage: release.ts version|pack|sign|changelog (see the comment at the top)');
  }
}

// import.meta.main is false for .ts entry files in Node 24.2.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: Error) => {
    console.error(`release: ${err.message}`);
    process.exitCode = 1;
  });
}
