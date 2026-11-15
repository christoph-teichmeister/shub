// Pure helpers for starting sessions: prompts from buttons, permission modes, names, commands.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { HttpError } from '../api/router.ts';
import {
  PERMISSION_MODES,
  type ButtonDef,
  type LaunchPermissionMode,
  type PermissionMode,
  type SessionKind,
} from '../../shared/api.ts';

const SIMPLE_INPUT = /^[A-Za-z0-9#._/-]{1,80}$/;

/** One argument for sh/bash, single-quoted. */
export const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

export function isSimpleInput(input: string | undefined): boolean {
  return input === undefined || input === '' || SIMPLE_INPUT.test(input);
}

export function buttonPrompt(button: ButtonDef, input = ''): string {
  if (button.skill) return `${button.skill} ${input}`.trim();
  return (button.prompt ?? '').replaceAll('{input}', input);
}

/**
 * A locked button never runs outside default; otherwise a button's own mode wins. Without one, only the user
 * (and the global Claude) get the app setting, so sessions and plugins never inherit a prompt-skipping mode.
 * Exception: with "Sessions may act without asking" on, a session's own start runs in bypassPermissions.
 */
export function permissionModeFor(
  button: ButtonDef | undefined,
  setting: LaunchPermissionMode = 'default',
  byUser = false,
  trustedSession = false,
): LaunchPermissionMode {
  if (button?.lockDefaultMode) return 'default';
  return button?.permissionMode ?? (byUser ? setting : trustedSession ? 'bypassPermissions' : 'default');
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return (PERMISSION_MODES as unknown[]).includes(value);
}

export function isLaunchPermissionMode(value: unknown): value is LaunchPermissionMode {
  return value === 'inherit' || isPermissionMode(value);
}

export function autoName(opts: { button?: ButtonDef; input?: string; prompt?: string; n: number }): string {
  if (opts.button) return [opts.button.label, opts.input].filter(Boolean).join(' ');
  const words = (opts.prompt ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '');
  return `Session ${opts.n}`;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  );
}

export interface LaunchSpec {
  kind: SessionKind;
  claudeSessionId: string | null;
  settingsFile: string;
  /** kind "shell", bash only: rc file that loads the login files and makes `claude` a shub session. */
  shellRc?: string;
  permissionMode: LaunchPermissionMode;
  prompt?: string;
  /** Resume an existing Claude conversation instead of starting one. */
  resume: boolean;
  /** With resume: continue in a new conversation, the original stays as it is. */
  fork?: boolean;
}

/** Fence info word that marks a command Claude hands over (```bash shub-run); hooks/transition.ts picks it up. */
export const RUN_MARKER = 'shub-run';
export const RUN_HINT =
  `When the user has to run a shell command themselves (you cannot or should not run it), put exactly that ` +
  `command in its own fenced block opened with \`\`\`bash ${RUN_MARKER} — shub then offers to run it. ` +
  `Use plain \`\`\`bash for every other block, examples and commands you ran included. ` +
  `When the command belongs in another shub session or folder, name it after the marker: ` +
  `\`\`\`bash ${RUN_MARKER} session=<id> or \`\`\`bash ${RUN_MARKER} cwd=<folder>; \`shub session list\` shows ` +
  `the sessions with their ids and folders.`;

/**
 * bash rc for shub terminals: what a login shell loads, then `claude` without arguments, or with one prompt
 * argument (`claude "fix the build"`: not a flag, has a space), starts a tracked shub session in a new tab
 * (`shub claude`). Anything else (flags, subcommands like `claude update`) is the real claude, without this
 * terminal's id.
 */
export const shellRc = (shub: string): string => `# Written by shub for its terminals.
[ -r /etc/profile ] && . /etc/profile
for f in ~/.bash_profile ~/.bash_login ~/.profile; do [ -r "$f" ] && { . "$f"; break; }; done
claude() {
  if [ $# -eq 0 ]; then ${shub} claude
  elif [ $# -eq 1 ] && [[ "$1" != -* && "$1" == *" "* ]]; then ${shub} claude "$1"
  else env -u SHUB_SESSION_ID claude "$@"; fi
}
`;

/** argv run inside tmux. Tests swap this for `sleep` or `bash`. */
export type Launcher = (spec: LaunchSpec) => string[];

export const defaultLauncher: Launcher = (spec) => {
  if (spec.kind === 'shell') {
    const shell = process.env.SHELL || '/bin/bash';
    return basename(shell) === 'bash' && spec.shellRc ? [shell, '--rcfile', spec.shellRc, '-i'] : [shell, '-l'];
  }
  // When Claude exits (Ctrl+C twice, /exit) the pane drops into a login shell instead of ending the session;
  // closing the session (Alt+W) still kills tmux.
  const script = 'claude "$@"; exec "${SHELL:-/bin/bash}" -l';
  const args = ['sh', ...claudeArgs(spec).slice(1)];
  const shell = process.env.SHELL || '/bin/bash';
  if (!['bash', 'zsh'].includes(basename(shell))) return ['/bin/sh', '-c', script, ...args];
  // A login shell gives Claude the environment a terminal gets (tokens exported from the user's profile);
  // the tmux server only has what systemd gave shub at boot. shub's own PATH stays in front of the profile's.
  return [
    'env',
    `SHUB_PATH=${process.env.PATH ?? ''}`,
    shell,
    '-l',
    '-c',
    `PATH="$SHUB_PATH:$PATH"; unset SHUB_PATH; ${script}`,
    ...args,
  ];
};

const execFileAsync = promisify(execFile);

export const CLAUDE_MISSING =
  'Claude Code not found: install it (npm i -g @anthropic-ai/claude-code), then run `claude` once to log in.';

/**
 * A checker that answers 503 when `claude` cannot be found. It approximates the real launch (bash and zsh: login
 * shell, other shells such as fish: /bin/sh; ~/.local/bin added) without running it, so a profile that only
 * changes PATH in the pane itself can still differ. Async, so a slow profile never blocks the event loop; a
 * positive answer is cached for the life of the checker.
 */
export function claudeChecker(): () => Promise<void> {
  let found = false;
  return async () => {
    if (found) return;
    const shell = process.env.SHELL || '/bin/bash';
    const login = ['bash', 'zsh'].includes(basename(shell));
    try {
      await execFileAsync(login ? shell : '/bin/sh', [...(login ? ['-l'] : []), '-c', 'command -v claude'], {
        env: { ...process.env, PATH: `${process.env.PATH ?? ''}:${join(homedir(), '.local', 'bin')}` },
        timeout: 10_000,
      });
      found = true;
    } catch (err) {
      // A slow profile (killed by the timeout) is not proof that claude is missing.
      if (!(err as { killed?: boolean }).killed) throw new HttpError(503, CLAUDE_MISSING);
    }
  };
}

export const requireClaude = claudeChecker();

/** `claude ...` argv without the shell fallback. */
export const claudeArgs = (spec: LaunchSpec): string[] => {
  const id = spec.resume
    ? ['--resume', spec.claudeSessionId!, ...(spec.fork ? ['--fork-session'] : [])]
    : ['--session-id', spec.claudeSessionId!];
  // Passed unless the setting says "inherit": the user's own default may be a prompt-skipping one.
  const mode = spec.permissionMode === 'inherit' ? [] : ['--permission-mode', spec.permissionMode];
  const args = ['claude', ...id, '--settings', spec.settingsFile, '--append-system-prompt', RUN_HINT, ...mode];
  return spec.prompt && !spec.resume ? [...args, '--', spec.prompt] : args;
};
