// `shub service install|uninstall`: a systemd user unit (Linux) or a launchd agent (macOS) that runs `shub start`.
// Sessions live in shub's tmux server, a child of the service, so stopping the service must only stop shub itself:
// KillMode=process (systemd) and AbandonProcessGroup (launchd). The updater relies on that too.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { shubHome } from './versions.ts';

const MARKER = 'Written by `shub service install`';
export const UNIT = 'shub.service';
export const LABEL = 'com.github.christoph-teichmeister.shub';

export interface ServiceOptions {
  /** Absolute paths: the node binary and the launcher script. */
  node: string;
  launcher: string;
  home: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Environment the service needs: PATH (tmux, claude, docker), shub's own settings. No NODE_ENV: tmux hands the
 * service's environment to every session, and NODE_ENV=production there makes `npm ci` skip dev dependencies.
 */
function serviceEnv(o: ServiceOptions): Record<string, string> {
  const out: Record<string, string> = {
    SHUB_HOME: o.home,
    PATH: o.env.PATH ?? '/usr/bin:/bin',
  };
  for (const key of ['SHUB_PORT', 'SHUB_PUBLIC_URL', 'SHUB_CONFIG_DIR', 'SHUB_STATE_DIR']) {
    if (o.env[key]) out[key] = o.env[key]!;
  }
  return out;
}

export function systemdUnit(o: ServiceOptions): string {
  const env = Object.entries(serviceEnv(o)).map(([k, v]) => `Environment="${k}=${v.replace(/["\\]/g, '\\$&')}"`);
  return [
    `# ${MARKER}; \`shub service uninstall\` removes it.`,
    '[Unit]',
    'Description=shub, your session hub',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart="${o.node}" "${o.launcher}" start`,
    ...env,
    'Restart=on-failure',
    'RestartSec=3',
    "# Sessions live in shub's tmux server, a child of this unit: keep it (and a running update) alive across restarts.",
    'KillMode=process',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function launchdPlist(o: ServiceOptions): string {
  const env = Object.entries(serviceEnv(o))
    .map(([k, v]) => `      <key>${xml(k)}</key><string>${xml(v)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${MARKER}; \`shub service uninstall\` removes it. -->
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xml(o.node)}</string>
      <string>${xml(o.launcher)}</string>
      <string>start</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${env}
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
    <!-- Sessions live in shub's tmux server: keep it (and a running update) alive across restarts. -->
    <key>AbandonProcessGroup</key><true/>
    <key>StandardOutPath</key><string>${xml(join(o.home, 'shub.log'))}</string>
    <key>StandardErrorPath</key><string>${xml(join(o.home, 'shub.log'))}</string>
  </dict>
</plist>
`;
}

export type Run = (cmd: string, args: string[]) => void;

const runQuiet: Run = (cmd, args) => void execFileSync(cmd, args, { stdio: 'ignore' });
const succeeds = (run: Run, cmd: string, args: string[]): boolean => {
  try {
    run(cmd, args);
    return true;
  } catch {
    return false;
  }
};

export interface Service {
  file: string;
  install(o: ServiceOptions, force?: boolean): string;
  uninstall(): string;
  /**
   * Is the app of this launcher home running as our service? A hand-written systemd unit counts only when its
   * ExecStart runs `shub start` (the launcher) for this home; one that starts a git checkout never does.
   */
  active(home: string): boolean;
  /** The node binary our systemd unit starts, or null (no unit, not ours, or launchd). */
  unitNode(): string | null;
  /**
   * Points our systemd unit's ExecStart at `o`'s node and launcher when it starts others (nvm replaced the node it was
   * installed with). Only that line changes and nothing restarts; true when it rewrote the file.
   */
  refresh(o: ServiceOptions): boolean;
  restart(): void;
}

export function service(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  run: Run = runQuiet,
): Service {
  const darwin = platform === 'darwin';
  const userHome = env.HOME ?? homedir();
  const file = darwin
    ? join(userHome, 'Library', 'LaunchAgents', `${LABEL}.plist`)
    : join(env.XDG_CONFIG_HOME ?? join(userHome, '.config'), 'systemd', 'user', UNIT);
  const target = `gui/${process.getuid?.() ?? 0}`;
  const text = () => (existsSync(file) ? readFileSync(file, 'utf8') : null);
  const ours = () => text()?.includes(MARKER) ?? true;

  return {
    file,
    install(o, force = false) {
      if (!ours() && !force) {
        throw new Error(`${file} exists and was not written by shub; move it away or run with --force`);
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, darwin ? launchdPlist(o) : systemdUnit(o));
      if (darwin) {
        succeeds(run, 'launchctl', ['bootout', `${target}/${LABEL}`]);
        run('launchctl', ['bootstrap', target, file]);
        return `Installed ${file} and started it. Logs: ${join(o.home, 'shub.log')}`;
      }
      run('systemctl', ['--user', 'daemon-reload']);
      run('systemctl', ['--user', 'enable', '--now', UNIT]);
      return [
        `Installed ${file} and started it. Logs: journalctl --user -u shub -f`,
        'To keep shub running while you are logged out: loginctl enable-linger $USER',
      ].join('\n');
    },
    uninstall() {
      if (!existsSync(file)) return `No service installed (${file}).`;
      if (!ours()) throw new Error(`${file} was not written by shub; remove it yourself`);
      if (darwin) succeeds(run, 'launchctl', ['bootout', `${target}/${LABEL}`]);
      else succeeds(run, 'systemctl', ['--user', 'disable', '--now', UNIT]);
      rmSync(file);
      if (!darwin) run('systemctl', ['--user', 'daemon-reload']);
      return `Removed ${file}. Sessions in tmux keep running.`;
    },
    active(home) {
      const unit = text();
      const forHome = darwin ? `<string>${xml(home)}</string>` : `SHUB_HOME=${home}"`;
      if (!unit) return false;
      const handWritten =
        !darwin &&
        /^ExecStart=.*\bshub"?\s+start\s*$/m.test(unit) &&
        (unit.includes('SHUB_HOME=') ? unit.includes(forHome) : home === shubHome({ ...env, SHUB_HOME: undefined }));
      if (!handWritten && (!unit.includes(MARKER) || !unit.includes(forHome))) return false;
      return darwin
        ? succeeds(run, 'launchctl', ['print', `${target}/${LABEL}`])
        : succeeds(run, 'systemctl', ['--user', 'is-active', '--quiet', UNIT]);
    },
    unitNode() {
      const unit = text();
      return !darwin && unit && ours() ? (/^ExecStart="([^"]+)"/m.exec(unit)?.[1] ?? null) : null;
    },
    refresh(o) {
      const unit = text();
      if (darwin || !unit || !ours()) return false;
      const next = unit.replace(/^ExecStart=.*$/m, `ExecStart="${o.node}" "${o.launcher}" start`);
      if (next === unit) return false;
      writeFileSync(file, next);
      run('systemctl', ['--user', 'daemon-reload']);
      return true;
    },
    restart() {
      if (darwin) run('launchctl', ['kickstart', '-k', `${target}/${LABEL}`]);
      else run('systemctl', ['--user', 'restart', UNIT]);
    },
  };
}
