// Pure helpers for starting sessions: prompts from buttons, permission modes, names, commands.
import type { ButtonDef, PermissionMode, SessionKind } from '../../shared/api.ts';

const SIMPLE_INPUT = /^[A-Za-z0-9#._/-]{1,80}$/;

export function isSimpleInput(input: string | undefined): boolean {
  return input === undefined || input === '' || SIMPLE_INPUT.test(input);
}

export function buttonPrompt(button: ButtonDef, input = ''): string {
  if (button.skill) return `${button.skill} ${input}`.trim();
  return (button.prompt ?? '').replaceAll('{input}', input);
}

/** Only a button may choose a prompt-skipping mode, and a locked button never runs outside default. */
export function permissionModeFor(button: ButtonDef | undefined): PermissionMode {
  return button && !button.lockDefaultMode ? (button.permissionMode ?? 'default') : 'default';
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
  permissionMode: PermissionMode;
  prompt?: string;
  /** Resume an existing Claude conversation instead of starting one. */
  resume: boolean;
}

/** argv run inside tmux. Tests swap this for `sleep` or `bash`. */
export type Launcher = (spec: LaunchSpec) => string[];

export const defaultLauncher: Launcher = (spec) => {
  if (spec.kind === 'shell') return [process.env.SHELL || '/bin/bash', '-l'];
  const id = spec.resume ? ['--resume', spec.claudeSessionId!] : ['--session-id', spec.claudeSessionId!];
  // The mode is always passed: the user's own default may be a prompt-skipping one.
  const args = ['claude', ...id, '--settings', spec.settingsFile, '--permission-mode', spec.permissionMode];
  return spec.prompt && !spec.resume ? [...args, '--', spec.prompt] : args;
};
