// The rights model from docs/SECURITY.md as pure functions. No I/O here: index.ts feeds in the
// rate-limit count and the button the request refers to.
import { PROMPT_SKIPPING_MODES } from '../../shared/api.ts';
import type { ButtonDef, ClientKind, Decision, Right } from '../../shared/api.ts';
import type { Caller } from '../api/router.ts';
import type { PermissionAction } from '../services.ts';

// A Record keyed by Right makes tsc fail when a new Right is added to shared/api.ts but not here.
const RIGHT_SET: Record<Right, true> = {
  read: true,
  'projects.write': true,
  'sessions.start': true,
  'sessions.start.button': true,
  'sessions.link': true,
  'buttons.write': true,
  'ui.contribute': true,
};
export const ALL_RIGHTS = Object.keys(RIGHT_SET) as Right[];

export function isRight(value: unknown): value is Right {
  return typeof value === 'string' && Object.hasOwn(RIGHT_SET, value);
}

/** Automatically allowed session starts per rolling hour across all non-user callers. */
export const AUTO_START_LIMIT = 5;
export const AUTO_START_WINDOW_MS = 60 * 60 * 1000;

export interface DecideEnv {
  /** Automatically allowed starts by non-user callers within the last AUTO_START_WINDOW_MS. */
  recentAutoStarts: number;
  /** The button a session.start refers to, if it exists. */
  button?: ButtonDef;
  /** Settings > "Sessions may act without asking": a project session's `ask` becomes `allow` (and its starts run in bypassPermissions). */
  trustSessions?: boolean;
}

const allow: Decision = { outcome: 'allow' };
const ask = (reason: string): Decision => ({ outcome: 'ask', reason });
const deny = (reason: string): Decision => ({ outcome: 'deny', reason });

export function rightsFor(kind: ClientKind, granted: Right[] = []): Right[] {
  switch (kind) {
    case 'user':
    case 'cli':
      return [...ALL_RIGHTS];
    case 'global-claude':
      return ['read', 'projects.write', 'sessions.start', 'sessions.start.button'];
    case 'session':
    case 'spawned-session':
      return ['read'];
    case 'plugin':
      return ALL_RIGHTS.filter((right) => granted.includes(right));
  }
}

export function decide(caller: Caller, action: PermissionAction, env: DecideEnv): Decision {
  const decision = trusted(caller, decideBase(caller, action, env), env);
  // The rate limit stays on, so a runaway session still ends up at an approval.
  return action.kind === 'session.start' ? limitAutoStarts(caller, decision, env) : decision;
}

function trusted(caller: Caller, decision: Decision, env: DecideEnv): Decision {
  return env.trustSessions && caller.kind === 'session' && decision.outcome === 'ask' ? allow : decision;
}

function decideBase(caller: Caller, action: PermissionAction, env: DecideEnv): Decision {
  switch (action.kind) {
    case 'session.start':
      return decideStart(caller, action, env);
    case 'projects.write':
      return decideByRight(caller, 'projects.write', 'allow');
    case 'buttons.write':
      // Button prompts run later without a second look, so a change from anyone but the user gets one.
      if (caller.kind === 'user') return allow;
      if (caller.kind === 'cli' || caller.kind === 'global-claude' || caller.kind === 'session') {
        return ask('button changes need your review');
      }
      return decideByRight(caller, 'buttons.write', 'ask');
    case 'projects.delete':
      return isHuman(caller) ? allow : deny('only you can delete projects');
    case 'session.close':
      if (isHuman(caller) || caller.id === `session:${action.sessionId}`) return allow;
      return deny('only you can close another session');
    case 'session.link':
      // A session may pin links to its own tab (e.g. its MR); other sessions' tabs still go by the right.
      if (caller.kind === 'session' && caller.id === `session:${action.sessionId}`) return allow;
      return decideByRight(caller, 'sessions.link', 'allow');
    case 'ui.contribute':
      if (caller.kind !== 'plugin') return isHuman(caller) ? allow : deny('only plugins contribute UI');
      return caller.rights.includes('ui.contribute') ? allow : deny('right ui.contribute not granted');
  }
}

function isHuman(caller: Caller): boolean {
  return caller.kind === 'user' || caller.kind === 'cli';
}

/** Writes other than session starts: user/cli allowed, global Claude only projects.write, sessions ask, plugins by grant. */
function decideByRight(caller: Caller, right: Right, whenGranted: 'allow' | 'ask'): Decision {
  switch (caller.kind) {
    case 'user':
    case 'cli':
      return allow;
    case 'global-claude':
      return right === 'projects.write' ? allow : ask(`global Claude has no ${right} right`);
    case 'session':
      return ask('project sessions are read-only');
    case 'spawned-session':
      return deny('sessions started by a session may not write (one level deep)');
    case 'plugin':
      if (!caller.rights.includes(right)) return deny(`right ${right} not granted`);
      return whenGranted === 'allow' ? allow : ask(`${right} from a plugin needs your review`);
  }
}

function decideStart(
  caller: Caller,
  action: Extract<PermissionAction, { kind: 'session.start' }>,
  env: DecideEnv,
): Decision {
  const { request, viaButton, simpleInput } = action;
  if (request.buttonId !== undefined && request.prompt !== undefined) return deny('use either a button or a prompt');
  if (viaButton !== (request.buttonId !== undefined)) return deny('viaButton does not match the request');
  if (viaButton && !env.button) return deny('unknown button');
  const mode = env.button?.permissionMode;
  if (mode && PROMPT_SKIPPING_MODES.includes(mode) && env.button?.lockDefaultMode) {
    return deny('button is locked to the default mode but sets a prompt-skipping mode');
  }

  const byButton = viaButton && simpleInput;
  switch (caller.kind) {
    case 'user':
    case 'cli':
      return allow;
    case 'global-claude':
      return byButton ? allow : ask('free prompt from global Claude');
    case 'session':
      return ask('project sessions are read-only; starting a session needs your OK');
    case 'spawned-session':
      return deny('sessions started by a session may not start sessions (one level deep)');
    case 'plugin':
      if (byButton && caller.rights.includes('sessions.start.button')) return allow;
      if (caller.rights.includes('sessions.start')) return ask('session start from a plugin needs your OK');
      if (viaButton && caller.rights.includes('sessions.start.button')) return ask('button input is not simple');
      return deny('right sessions.start not granted');
  }
}

function limitAutoStarts(caller: Caller, decision: Decision, env: DecideEnv): Decision {
  if (decision.outcome !== 'allow' || caller.kind === 'user') return decision;
  if (env.recentAutoStarts < AUTO_START_LIMIT) return decision;
  return ask(`more than ${AUTO_START_LIMIT} automatic session starts within the last hour`);
}

/** Readable diff of button prompts for the buttons.write approval card. */
export function buttonPromptDiff(before: ButtonDef[], after: ButtonDef[]): string {
  const text = (b: ButtonDef) =>
    [b.skill, b.prompt, b.permissionMode && `mode: ${b.permissionMode}`, b.lockDefaultMode && 'locked']
      .filter(Boolean)
      .join(' | ');
  const lines: string[] = [];
  const old = new Map(before.map((b) => [b.id, b]));
  for (const b of after) {
    const prev = old.get(b.id);
    old.delete(b.id);
    if (!prev) lines.push(`+ ${b.label}: ${text(b)}`);
    else if (text(prev) !== text(b) || prev.label !== b.label) {
      lines.push(`- ${prev.label}: ${text(prev)}`, `+ ${b.label}: ${text(b)}`);
    }
  }
  for (const b of old.values()) lines.push(`- ${b.label}: ${text(b)}`);
  return lines.join('\n');
}
