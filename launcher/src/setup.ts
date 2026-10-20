// `shub install` in a terminal: a guided setup. Checks the machine, asks for channel, port and public URL, installs the
// release, starts the background service and ends with the URL and the access token.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { styleText } from 'node:util';
import type { Finding } from './doctor.ts';
import type { Channel } from './releases.ts';

export interface SetupDeps {
  ask(question: string): Promise<string>;
  log(line: string): void;
  platform: NodeJS.Platform;
  /** Machine checks; the port is asked for in its own step. */
  doctor(): Promise<Finding[]>;
  portState(port: number): Promise<'free' | 'shub' | 'busy'>;
  configuredChannel: string | undefined;
  writeChannel(channel: Channel): void;
  installed(): string | null;
  /** Installs the latest release of the channel and returns its version, or null when that failed. */
  install(channel: Channel): Promise<string | null>;
  /** Writes and starts the service with these extra environment variables; throws when a foreign unit is in the way. */
  installService(env: Record<string, string>, force: boolean): string;
  health(port: number, version: string): Promise<boolean>;
  token(): string | null;
  tokenFile: string;
  copy(text: string): boolean;
  open(url: string): void;
}

const STEPS = 6;
const DEFAULT_PORT = 4780;

const bold = (s: string) => styleText('bold', s);
const dim = (s: string) => styleText('dim', s);
const mark = (f: Finding) =>
  f.ok ? styleText('green', '✓') : f.optional ? styleText('yellow', '•') : styleText('red', '✗');

function installHint(platform: NodeJS.Platform, name: string): string | null {
  if (name === 'tmux') return platform === 'darwin' ? 'brew install tmux' : 'sudo apt install tmux   (or dnf, pacman)';
  if (name === 'Claude Code') return 'npm i -g @anthropic-ai/claude-code';
  if (name === 'Node') return 'nvm install 24   (or your package manager)';
  return null;
}

async function yes(d: SetupDeps, question: string, fallback: boolean): Promise<boolean> {
  const answer = (await d.ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
  return answer === '' ? fallback : answer.startsWith('y') || answer.startsWith('j');
}

function box(lines: string[]): string[] {
  const width = Math.max(...lines.map((l) => l.length));
  return [`┌${'─'.repeat(width + 2)}┐`, ...lines.map((l) => `│ ${l.padEnd(width)} │`), `└${'─'.repeat(width + 2)}┘`];
}

/** Returns false when the user quit. */
export async function setup(d: SetupDeps): Promise<boolean> {
  let n = 0;
  const step = (title: string) => d.log(`\n${bold(`[${++n}/${STEPS}] ${title}`)}`);
  d.log(bold('shub setup') + dim('  (Ctrl+C quits, nothing is changed before step 4)'));

  step('Check this machine');
  for (;;) {
    const findings = await d.doctor();
    for (const f of findings) d.log(`  ${mark(f)} ${f.name.padEnd(12)}${f.detail}`);
    const missing = findings.filter((f) => !f.ok && !f.optional);
    if (missing.length === 0) break;
    d.log('\n  Install what is missing in another terminal:');
    for (const f of missing) {
      const hint = installHint(d.platform, f.name);
      if (hint) d.log(`    ${hint}`);
    }
    const answer = await d.ask('\n  Enter checks again, q quits: ');
    if (answer.trim().toLowerCase() === 'q') return false;
  }

  step('Update channel');
  d.log(dim('  stable: tested releases. beta: every merge into develop, earlier and rougher.'));
  const preset = d.configuredChannel === 'beta' ? 'beta' : 'stable';
  let channel: Channel = preset;
  for (;;) {
    const answer = (await d.ask(`  Channel, stable or beta (${preset}): `)).trim().toLowerCase() || preset;
    if (answer === 'stable' || answer === 'beta') {
      channel = answer;
      break;
    }
    d.log(`  "${answer}" is not a channel.`);
  }

  step('Port and access');
  let port = DEFAULT_PORT;
  for (;;) {
    const answer = (await d.ask(`  Port (${DEFAULT_PORT}): `)).trim() || String(DEFAULT_PORT);
    const p = Number(answer);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      d.log('  A port is a number from 1024 to 65535.');
      continue;
    }
    const state = await d.portState(p);
    if (state !== 'busy') {
      port = p;
      if (state === 'shub') d.log(`  shub already answers on ${p}.`);
      break;
    }
    d.log(`  127.0.0.1:${p} is used by another program, pick another one.`);
  }
  d.log(dim('  shub listens on 127.0.0.1 only. For the phone, put it behind `tailscale serve` and enter that URL.'));
  let publicUrl = '';
  for (;;) {
    publicUrl = (await d.ask('  Public URL (Enter skips): ')).trim().replace(/\/$/, '');
    if (publicUrl === '' || /^https:\/\/\S+$/.test(publicUrl)) break;
    d.log('  The public URL starts with https://');
  }

  step('Install shub');
  d.writeChannel(channel);
  let version = d.installed();
  if (version) d.log(`  shub ${version} is already installed. Newer versions: shub update`);
  else {
    version = await d.install(channel);
    if (!version) return false;
  }

  step('Run in the background');
  const url = `http://127.0.0.1:${port}`;
  let running = false;
  if (await yes(d, '  Run shub as a background service that starts with your login?', true)) {
    const env: Record<string, string> = {};
    if (port !== DEFAULT_PORT) env.SHUB_PORT = String(port);
    if (publicUrl) env.SHUB_PUBLIC_URL = publicUrl;
    let force = false;
    for (;;) {
      try {
        for (const line of d.installService(env, force).split('\n')) d.log(`  ${line}`);
        break;
      } catch (err) {
        d.log(`  ${(err as Error).message}`);
        if (force || !(await yes(d, '  Replace it?', false))) break;
        force = true;
      }
    }
    d.log('  Waiting for shub to answer ...');
    running = await d.health(port, version);
    d.log(
      running
        ? `  shub ${version} runs on ${url}`
        : '  shub did not answer within 30 s. Logs: shub doctor, then the service logs above.',
    );
  } else {
    d.log(`  Start it yourself with: ${port === DEFAULT_PORT ? '' : `SHUB_PORT=${port} `}shub start`);
  }

  step('Log in');
  const token = d.token();
  if (!token) {
    d.log('  shub creates your access token when it starts for the first time. Then: shub token');
    return true;
  }
  d.log(`  Open ${bold(url)}${publicUrl ? ` (or ${bold(publicUrl)})` : ''} and log in with this token:\n`);
  for (const line of box([token])) d.log(`  ${line}`);
  d.log(dim(`\n  It lives in ${d.tokenFile}. Print it again with: shub token`));
  if (d.copy(token)) d.log('  Copied to the clipboard.');
  if (running && (await yes(d, '\n  Open shub in the browser now?', true))) d.open(url);
  return true;
}

/** The app keeps the update channel in local.json (machine-only, wins over config.json); keep every other key. */
export function writeChannelTo(configDir: string, channel: Channel): void {
  const file = join(configDir, 'local.json');
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    // no local.json yet
  }
  if (config.updateChannel === channel) return;
  mkdirSync(configDir, { recursive: true });
  writeFileSync(file, JSON.stringify({ ...config, updateChannel: channel }, null, 2) + '\n');
}

export function readToken(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** First clipboard tool that works; false when there is none (e.g. over SSH). */
export function copyToClipboard(text: string, platform: NodeJS.Platform = process.platform): boolean {
  const tools: [string, string[]][] =
    platform === 'darwin'
      ? [['pbcopy', []]]
      : [
          ['wl-copy', []],
          ['xclip', ['-selection', 'clipboard']],
          ['xsel', ['-ib']],
        ];
  return tools.some(
    ([cmd, args]) =>
      spawnSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 3000 }).status === 0,
  );
}

export function openUrl(url: string, platform: NodeJS.Platform = process.platform): void {
  spawn(platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' })
    .on('error', () => {})
    .unref();
}
