// Pure helpers for starting sessions: prompts from buttons, permission modes, names, commands.
import { basename } from 'node:path';
import {
  PERMISSION_MODES,
  type ButtonDef,
  type LaunchPermissionMode,
  type PermissionMode,
  type SessionKind,
} from '../../shared/api.ts';

const SIMPLE_INPUT = /^[A-Za-z0-9#._/-]{1,80}$/;

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
 */
export function permissionModeFor(
  button: ButtonDef | undefined,
  setting: LaunchPermissionMode = 'default',
  byUser = false,
): LaunchPermissionMode {
  if (button?.lockDefaultMode) return 'default';
  return button?.permissionMode ?? (byUser ? setting : 'default');
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
  return ['/bin/sh', '-c', 'claude "$@"; exec "${SHELL:-/bin/bash}" -l', 'sh', ...claudeArgs(spec).slice(1)];
};

/** `claude ...` argv without the shell fallback. */
export const claudeArgs = (spec: LaunchSpec): string[] => {
  const id = spec.resume ? ['--resume', spec.claudeSessionId!] : ['--session-id', spec.claudeSessionId!];
  // Passed unless the setting says "inherit": the user's own default may be a prompt-skipping one.
  const mode = spec.permissionMode === 'inherit' ? [] : ['--permission-mode', spec.permissionMode];
  const args = ['claude', ...id, '--settings', spec.settingsFile, '--append-system-prompt', RUN_HINT, ...mode];
  return spec.prompt && !spec.resume ? [...args, '--', spec.prompt] : args;
};
