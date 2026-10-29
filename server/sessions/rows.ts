// The sessions table in sqlite: its migrations and how a row becomes a Session.
import type { HandedCommand, Session, SessionStatus } from '../../shared/api.ts';

export const MIGRATIONS = [
  `CREATE TABLE sessions (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT, name TEXT NOT NULL, cwd TEXT NOT NULL,
     status TEXT NOT NULL, claude_session_id TEXT, permission_mode TEXT NOT NULL, started_by TEXT NOT NULL,
     parent_id TEXT, links TEXT NOT NULL, created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL,
     pending_permission TEXT, token TEXT)`,
  `ALTER TABLE sessions ADD COLUMN waiting_for TEXT`,
  `ALTER TABLE sessions ADD COLUMN wait_check TEXT`,
  'ALTER TABLE sessions ADD COLUMN position INTEGER',
  `ALTER TABLE sessions ADD COLUMN pending_commands TEXT`,
  'ALTER TABLE sessions ADD COLUMN shells INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE sessions ADD COLUMN background_until INTEGER',
  'ALTER TABLE sessions ADD COLUMN tab_position INTEGER',
  'ALTER TABLE sessions ADD COLUMN agents TEXT',
  'ALTER TABLE sessions ADD COLUMN context TEXT',
  'ALTER TABLE sessions ADD COLUMN status_since TEXT',
  'UPDATE sessions SET status_since = last_activity_at',
];

export interface Row {
  id: string;
  kind: Session['kind'];
  project_id: string | null;
  name: string;
  cwd: string;
  status: SessionStatus;
  claude_session_id: string | null;
  permission_mode: Session['permissionMode'];
  started_by: string;
  parent_id: string | null;
  links: string;
  created_at: string;
  last_activity_at: string;
  pending_permission: string | null;
  pending_commands: string | null;
  shells: number;
  /** Epoch ms: a turn that ended on background work is handed back then if no hook came first. */
  background_until: number | null;
  token: string | null;
  waiting_for: string | null;
  wait_check: string | null;
  position: number | null;
  tab_position: number | null;
  agents: string | null;
  context: string | null;
  status_since: string;
}

export const toSession = (r: Row): Session => ({
  id: r.id,
  kind: r.kind,
  projectId: r.project_id,
  name: r.name,
  cwd: r.cwd,
  status: r.status,
  claudeSessionId: r.claude_session_id,
  permissionMode: r.permission_mode,
  startedBy: r.started_by,
  parentId: r.parent_id,
  links: JSON.parse(r.links),
  createdAt: r.created_at,
  lastActivityAt: r.last_activity_at,
  statusSince: r.status_since,
  pendingPermission: r.pending_permission ? JSON.parse(r.pending_permission) : null,
  waitingFor: r.waiting_for,
  waitCheck: r.wait_check ? JSON.parse(r.wait_check) : null,
  position: r.position,
  tabPosition: r.tab_position,
  // Rows from before targets stored plain strings.
  pendingCommands: r.pending_commands
    ? (JSON.parse(r.pending_commands) as (string | HandedCommand)[]).map((c) =>
        typeof c === 'string' ? { command: c } : c,
      )
    : null,
  shells: r.shells,
  background: r.background_until !== null,
  agents: r.agents ? JSON.parse(r.agents) : [],
  context: r.context ? JSON.parse(r.context) : null,
});
