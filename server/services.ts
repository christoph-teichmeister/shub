// Interfaces the server modules offer each other. main.ts wires the implementations.
// A module only depends on these interfaces, never on another module's internals.
import type { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage } from 'node:http';
import type {
  ActivityEntry,
  Approval,
  Config,
  Decision,
  OldSession,
  Project,
  ProjectView,
  Right,
  ServiceContainer,
  Session,
  SessionStatus,
  SkillInfo,
  StartSessionRequest,
} from '../shared/api.ts';
import type { Caller } from './api/router.ts';

/** server/state: one sqlite file in stateDir; each module creates its own tables via migrate(). */
export interface StateDb {
  db: DatabaseSync;
  migrate(module: string, statements: string[]): void;
}

/** server/config: ~/.config/shub/config.json, written atomically, emits config.changed. */
export interface ConfigStore {
  get(): Config;
  update(mutate: (config: Config) => void, actor: string): Config;
  project(id: string): Project | undefined;
  projectView(id: string): ProjectView | undefined;
  projectViews(): ProjectView[];
}

/** server/auth: login token, device cookies, pairing, per-client tokens. */
export interface Auth {
  /** Resolve the caller of an HTTP or WebSocket request, or null when not logged in. */
  resolve(req: IncomingMessage): Caller | null;
  /** Token for a Claude/plugin client; revoked when the client goes away. */
  issueClientToken(caller: Caller): string;
  revokeClientToken(token: string): void;
}

/** server/permissions: the rights model from docs/SECURITY.md. Pure decisions + approvals + activity log. */
export interface Permissions {
  decide(caller: Caller, action: PermissionAction): Decision;
  /** Store a pending approval, emit approval.created, push to the phone. */
  requestApproval(input: Omit<Approval, 'id' | 'createdAt' | 'state'>): Approval;
  /** Resolve when the user decides (or reject after timeoutMs). */
  waitForDecision(approvalId: string, timeoutMs?: number): Promise<boolean>;
  approvals(): Approval[];
  decideApproval(id: string, approve: boolean): Approval;
  log(entry: Omit<ActivityEntry, 'id' | 'at'>): ActivityEntry;
  activity(limit?: number): ActivityEntry[];
  rightsFor(kind: Caller['kind'], granted?: Right[]): Right[];
}

export type PermissionAction =
  | { kind: 'session.start'; request: StartSessionRequest; viaButton: boolean; simpleInput: boolean }
  | { kind: 'projects.write'; projectId: string | null }
  | { kind: 'projects.delete'; projectId: string }
  | { kind: 'buttons.write'; projectId: string; diff: string }
  | { kind: 'session.close'; sessionId: string }
  | { kind: 'session.link'; sessionId: string }
  | { kind: 'ui.contribute' };

/** server/sessions: tmux-backed Claude sessions and plain shells. */
export interface Sessions {
  list(): Session[];
  get(id: string): Session | undefined;
  /** Permission checks happen before; this just starts. */
  start(request: StartSessionRequest, startedBy: string): Promise<Session>;
  setStatus(id: string, status: SessionStatus, pendingPermission?: Session['pendingPermission']): void;
  sendKeys(id: string, keys: string[]): void;
  oldSessions(projectId: string): OldSession[];
}

/** server/notify: desktop notifications and web push. */
export interface Notify {
  needsYou(session: Session, text: string): void;
  yourTurn(session: Session): void;
  approval(approval: Approval): void;
  test(): Promise<void>;
}

/** server/docker: Engine API over the unix socket. */
export interface Docker {
  containersFor(cwd: string): Promise<ServiceContainer[]>;
}

/** server/skills: project and global skill discovery. */
export interface Skills {
  forProject(projectPath: string): SkillInfo[];
}

export interface Services {
  state: StateDb;
  config: ConfigStore;
  auth: Auth;
  permissions: Permissions;
  sessions: Sessions;
  notify: Notify;
  docker: Docker;
  skills: Skills;
}
