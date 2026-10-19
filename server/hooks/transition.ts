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
  for (const key of ['command', 'file_path', 'url', 'pattern', 'path', 'query', 'description']) {
    if (typeof fields[key] === 'string') return truncate(fields[key]);
  }
  return truncate(JSON.stringify(input));
}

const NEW_ID_SOURCES = new Set(['clear', 'compact', 'startup']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Claude session id to remember after a SessionStart, or null when it stays the same. */
export function newClaudeSessionId(current: string | null, payload: Record<string, unknown>): string | null {
  const id = payload.session_id;
  if (!NEW_ID_SOURCES.has(String(payload.source)) || typeof id !== 'string' || !UUID.test(id)) return null;
  return id === current ? null : id;
}

export function transition(
  current: SessionStatus,
  event: HookEvent,
  payload: Record<string, unknown>,
): Transition | null {
  switch (event) {
    case 'UserPromptSubmit':
      return { status: 'working', pendingPermission: null };
    case 'Stop':
      return { status: 'your-turn', pendingPermission: null, notify: { kind: 'yourTurn' } };
    case 'PermissionRequest': {
      const tool = String(payload.tool_name ?? 'tool');
      const summary = summarizeTool(payload.tool_input);
      return {
        status: 'needs-you',
        pendingPermission: { tool, summary },
        notify: { kind: 'needsYou', text: summary ? `${tool}: ${summary}` : tool },
      };
    }
    case 'Notification': {
      const type = String(payload.notification_type ?? '');
      const message = String(payload.message ?? '');
      const needsYou = NEEDS_YOU_NOTIFICATIONS.has(type) || /permission|waiting for your input/i.test(message);
      if (!needsYou) return null;
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
