// Pure mapping from a Claude Code hook event to a session status change.
//
// Payload facts (Claude Code 2.1.303, checked with a real `claude -p` run plus the CLI's bundled zod schema).
// Every event carries: session_id, transcript_path, cwd, hook_event_name, and mostly permission_mode, prompt_id.
//   UserPromptSubmit: { prompt, source?: 'user'|'sdk'|'system'|... }
//   Stop:             { stop_hook_active, last_assistant_message, background_tasks, ... }
//   Notification:     { message, title?, notification_type }  types seen in the CLI: permission_prompt,
//                     idle_prompt, elicitation_dialog, auth_success
//   PermissionRequest:{ tool_name, tool_input, permission_suggestions?, mcp_server? }
//   PostToolUse:      { tool_name, tool_input, tool_response }  the tool ran, so any permission question was
//                     answered (in the terminal or by the auto mode classifier).
//                     Its permission_mode also lets a shift+tab switch show during a turn.
//   SessionStart:     { source: 'startup'|'resume'|'clear'|'compact' }  no status meaning, but /clear (and
//                     compact, or a fresh start) can bring a new session_id: see newClaudeSessionId.
import type { Session, SessionStatus } from '../../shared/api.ts';

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
  notify?: { kind: 'yourTurn' } | { kind: 'needsYou'; text: string };
  /** The turn ended but background work still runs; shub falls back to your-turn if nothing follows. */
  background?: true;
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
      return { status: 'working', pendingPermission: null };
    case 'Stop': {
      // A background shell or agent still runs and wakes Claude when it ends: the turn is not over.
      // Servers and watchers never end, so they do not count; other shells get the fallback timer.
      const work = backgroundWork(payload.background_tasks);
      if (work === 'ending') return { status: 'working', pendingPermission: null };
      if (work === 'open') return { status: 'working', pendingPermission: null, background: true };
      if (waiting) return { status: 'waiting', pendingPermission: null };
      return { status: 'your-turn', pendingPermission: null, notify: { kind: 'yourTurn' } };
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
      return current === 'needs-you' ? { status: 'working', pendingPermission: null } : null;
    case 'SessionStart':
      return null;
  }
}
