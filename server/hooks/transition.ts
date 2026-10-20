// Pure mapping from a Claude Code hook event to a session status change.
//
// Payload facts (Claude Code 2.1.303, checked with a real `claude -p` run plus the CLI's bundled zod schema).
// Every event carries: session_id, transcript_path, cwd, hook_event_name, and mostly permission_mode, prompt_id.
//   UserPromptSubmit: { prompt, source?: 'user'|'sdk'|'system'|... }
//   Stop:             { stop_hook_active, last_assistant_message, background_tasks, ... }  the message is
//                     raw Markdown, so code fences survive (the terminal render drops them).
//   Notification:     { message, title?, notification_type }  types seen in the CLI: permission_prompt,
//                     idle_prompt, elicitation_dialog, auth_success
//   PermissionRequest:{ tool_name, tool_input, permission_suggestions?, mcp_server? }
//   PostToolUse:      { tool_name, tool_input, tool_response }  the tool ran, so any permission question was
//                     answered (in the terminal or by the auto mode classifier).
//                     Its permission_mode also lets a shift+tab switch show during a turn.
//   SessionStart:     { source: 'startup'|'resume'|'clear'|'compact' }  no status meaning, but /clear (and
//                     compact, or a fresh start) can bring a new session_id: see newClaudeSessionId.
import type { Session, SessionStatus } from '../../shared/api.ts';
import { RUN_MARKER } from '../sessions/launch.ts';

export const HOOK_EVENTS = [
  'UserPromptSubmit',
  'Stop',
  'Notification',
  'PermissionRequest',
  'PostToolUse',
  'SessionStart',
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface Transition {
  status: SessionStatus;
  /** undefined = leave as is. */
  pendingPermission?: Session['pendingPermission'];
  /** undefined = leave as is. */
  pendingCommands?: Session['pendingCommands'];
  notify?: { kind: 'yourTurn' } | { kind: 'needsYou'; text: string };
  /** The turn ended but background work still runs; shub falls back to your-turn if nothing follows. */
  background?: true;
  /** Background shells still running at the end of the turn (0 or undefined: none). */
  shells?: number;
}

const SUMMARY_MAX = 200;
const NEEDS_YOU_NOTIFICATIONS = new Set(['permission_prompt', 'idle_prompt', 'elicitation_dialog']);

export function isHookEvent(name: string): name is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(name);
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_MAX ? flat.slice(0, SUMMARY_MAX - 1) + '…' : flat;
}

/** The one line the phone shows for a permission question. */
export function summarizeTool(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const fields = input as Record<string, unknown>;
  const question = summarizeQuestions(fields.questions);
  if (question) return question;
  for (const key of ['command', 'file_path', 'url', 'pattern', 'path', 'query', 'description']) {
    if (typeof fields[key] === 'string') return truncate(fields[key]);
  }
  return truncate(JSON.stringify(input));
}

/** AskUserQuestion: "Question? (A / B)", plus how many more follow. */
function summarizeQuestions(questions: unknown): string {
  if (!Array.isArray(questions) || typeof questions[0]?.question !== 'string') return '';
  const [first, ...rest] = questions as { question: string; options?: { label?: unknown }[] }[];
  const labels = (first.options ?? []).map((o) => o?.label).filter((l) => typeof l === 'string');
  const more = rest.length ? ` +${rest.length} more` : '';
  return truncate(`${first.question}${labels.length ? ` (${labels.join(' / ')})` : ''}${more}`);
}

/** Shell commands that run until stopped (servers, watchers, log tails): Claude does not wait for them. */
const ENDLESS_COMMANDS = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview|watch)\b/,
  /\bvite\b(?!\s+build)/,
  /\b(nodemon|uvicorn|gunicorn|http-server|live-server)\b/,
  /\bmanage\.py\s+runserver\b/,
  /\bpython3?\s+-m\s+http\.server\b/,
  /--watch\b/,
  /\b(tail|journalctl|logs)\b.*\s(-f|--follow)\b/,
  /\bdocker[\s-]compose\s+up\b(?!.*\s(-d|--detach)\b)/,
];
/** Task types that always end on their own; anything else (shells, monitors) may not. */
const ENDING_TASKS = new Set(['subagent', 'workflow']);

interface BackgroundTask {
  type?: unknown;
  command?: unknown;
}

/** What a Stop's background tasks mean: nothing to wait for, work that ends, or work that may never end. */
function backgroundWork(tasks: unknown): 'none' | 'ending' | 'open' {
  if (!Array.isArray(tasks)) return 'none';
  const awaited = (tasks as BackgroundTask[]).filter(
    (t) => !(t?.type === 'shell' && ENDLESS_COMMANDS.some((re) => re.test(String(t.command ?? '')))),
  );
  if (!awaited.length) return 'none';
  return awaited.every((t) => ENDING_TASKS.has(String(t?.type))) ? 'ending' : 'open';
}

/** How many background shells still run, servers included. */
function runningShells(tasks: unknown): number {
  return Array.isArray(tasks) ? tasks.filter((t) => (t as BackgroundTask)?.type === 'shell').length : 0;
}

/** The last message ends on a question (choices in brackets may follow): Claude waits for the user,
 *  whatever still runs in the background. */
export function endsWithQuestion(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  const last = message.trimEnd().split('\n').pop() ?? '';
  return /\?(\s*\([^)]*\))?[\s*_)\]"'`]*$/.test(last);
}

const FENCE = /^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;
const COMMANDS_MAX = 5;

/**
 * Shell commands Claude hands over in its last message: only fenced blocks whose info string carries RUN_MARKER
 * (shub's sessions are told so at launch), so examples and commands Claude ran stay quiet. A leading "$ " goes.
 */
export function handedOverCommands(message: unknown): string[] {
  if (typeof message !== 'string') return [];
  return [...message.matchAll(FENCE)]
    .filter((m) => m[1].trim().split(/\s+/).includes(RUN_MARKER))
    .map((m) => m[2].replace(/^\$ /gm, '').trim())
    .filter(Boolean)
    .slice(0, COMMANDS_MAX);
}

const NEW_ID_SOURCES = new Set(['clear', 'compact', 'startup']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Claude session id to remember after a SessionStart, or null when it stays the same. */
export function newClaudeSessionId(current: string | null, payload: Record<string, unknown>): string | null {
  const id = payload.session_id;
  if (!NEW_ID_SOURCES.has(String(payload.source)) || typeof id !== 'string' || !UUID.test(id)) return null;
  return id === current ? null : id;
}

/** `waiting`: the session has a `waitingFor`, so a finished turn parks it again instead of "your-turn". */
export function transition(
  current: SessionStatus,
  event: HookEvent,
  payload: Record<string, unknown>,
  waiting = false,
): Transition | null {
  switch (event) {
    case 'UserPromptSubmit':
      return { status: 'working', pendingPermission: null, pendingCommands: null };
    case 'Stop': {
      // A background shell or agent still runs and wakes Claude when it ends: the turn is not over.
      // Servers and watchers never end, so they do not count; other shells get the fallback timer.
      // A closing question hands the turn over anyway: Claude waits for the answer, not for the shell.
      const work = endsWithQuestion(payload.last_assistant_message) ? 'none' : backgroundWork(payload.background_tasks);
      if (work === 'ending') return { status: 'working', pendingPermission: null };
      if (work === 'open') return { status: 'working', pendingPermission: null, background: true };
      const shells = runningShells(payload.background_tasks);
      const commands = handedOverCommands(payload.last_assistant_message);
      if (commands.length) {
        // Commands win over a wait: they need the user now.
        const more = commands.length > 1 ? ` (+${commands.length - 1} more)` : '';
        return {
          status: 'needs-you',
          pendingPermission: null,
          pendingCommands: commands,
          shells,
          notify: { kind: 'needsYou', text: `Run: ${truncate(commands[0])}${more}` },
        };
      }
      if (waiting) return { status: 'waiting', pendingPermission: null, pendingCommands: null, shells };
      return {
        status: 'your-turn',
        pendingPermission: null,
        pendingCommands: null,
        shells,
        notify: { kind: 'yourTurn' },
      };
    }
    case 'PermissionRequest': {
      const tool = String(payload.tool_name ?? 'tool');
      const summary = summarizeTool(payload.tool_input);
      return {
        status: 'needs-you',
        pendingPermission: { tool, summary },
        notify: {
          kind: 'needsYou',
          text: tool === 'AskUserQuestion' && summary ? summary : summary ? `${tool}: ${summary}` : tool,
        },
      };
    }
    case 'Notification': {
      const type = String(payload.notification_type ?? '');
      const message = String(payload.message ?? '');
      const needsYou = NEEDS_YOU_NOTIFICATIONS.has(type) || /permission|waiting for your input/i.test(message);
      // Claude's idle reminder means nothing before the first prompt, while the session waits on purpose,
      // nor while it is still working (it fires after a Stop that left background tasks running).
      const idleIgnored = current === 'new' || current === 'working' || waiting;
      if (!needsYou || (type === 'idle_prompt' && idleIgnored)) return null;
      // PermissionRequest usually fired just before for the same prompt; do not notify twice.
      if (current === 'needs-you') return { status: 'needs-you' };
      return { status: 'needs-you', notify: { kind: 'needsYou', text: message || 'Claude needs you' } };
    }
    case 'PostToolUse':
      return current === 'needs-you' ? { status: 'working', pendingPermission: null, pendingCommands: null } : null;
    case 'SessionStart':
      return null;
  }
}
