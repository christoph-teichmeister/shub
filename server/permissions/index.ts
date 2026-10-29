// Permissions: the pure rules from rules.ts plus approvals, the activity log and undo, stored in sqlite.
import { randomUUID } from 'node:crypto';
import type { ActivityEntry, Approval, Project } from '../../shared/api.ts';
import { ROUTES } from '../../shared/api.ts';
import { HttpError, requireRight, requireUser, type Caller } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { PermissionAction, Permissions, Services } from '../services.ts';
import { AUTO_START_WINDOW_MS, decide, rightsFor } from './rules.ts';

export const DEFAULT_APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;

/** Undo payloads other modules attach to activity entries. */
export type UndoAction =
  | { kind: 'project.add'; payload: { projectId: string } }
  | { kind: 'project.update'; payload: { projectId: string; previous: Partial<Project> } };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY, requested_by TEXT NOT NULL, action TEXT NOT NULL, project_id TEXT,
    summary TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS activity (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, at TEXT NOT NULL,
    actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, undo TEXT)`,
  // Automatically allowed session starts by non-user callers (ms timestamps), so a restart keeps the budget.
  `CREATE TABLE IF NOT EXISTS auto_starts (at INTEGER NOT NULL)`,
];

type Row = Record<string, unknown>;

const toApproval = (r: Row): Approval => ({
  id: r.id as string,
  requestedBy: r.requested_by as string,
  action: r.action as Approval['action'],
  projectId: (r.project_id as string | null) ?? null,
  summary: r.summary as string,
  detail: r.detail as string,
  createdAt: r.created_at as string,
  state: r.state as Approval['state'],
});

const toEntry = (r: Row): ActivityEntry => ({
  id: r.id as string,
  at: r.at as string,
  actor: r.actor as string,
  action: r.action as string,
  detail: r.detail as string,
  undo: r.undo ? JSON.parse(r.undo as string) : null,
});

export function create(
  ctx: Context,
  services: Services,
): { module: ShubModule; service: Permissions & PermissionsExtra } {
  let migrated = false;
  const db = () => {
    if (!migrated) services.state.migrate('permissions', SCHEMA);
    migrated = true;
    return services.state.db;
  };
  const waiters = new Map<string, ((approved: boolean) => void)[]>();

  const getApproval = (id: string): Approval | undefined => {
    const row = db().prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Row | undefined;
    return row && toApproval(row);
  };

  function settle(id: string, state: 'approved' | 'rejected'): Approval {
    db().prepare(`UPDATE approvals SET state = ? WHERE id = ? AND state = 'pending'`).run(state, id);
    const approval = getApproval(id)!;
    ctx.bus.emit({ type: 'approval.decided', approval });
    for (const resolve of waiters.get(id) ?? []) resolve(approval.state === 'approved');
    waiters.delete(id);
    return approval;
  }

  const service: Permissions & PermissionsExtra = {
    decide(caller: Caller, action: PermissionAction) {
      const now = Date.now();
      db()
        .prepare('DELETE FROM auto_starts WHERE at <= ?')
        .run(now - AUTO_START_WINDOW_MS);
      const { n } = db().prepare('SELECT COUNT(*) AS n FROM auto_starts').get() as { n: number };
      const button =
        action.kind === 'session.start' && action.request.buttonId !== undefined && action.request.projectId
          ? services.config.project(action.request.projectId)?.buttons.find((b) => b.id === action.request.buttonId)
          : undefined;
      const decision = decide(caller, action, {
        recentAutoStarts: n,
        button,
        trustSessions: services.config.get().trustSessions,
      });
      if (action.kind === 'session.start' && decision.outcome === 'allow' && caller.kind !== 'user') {
        db().prepare('INSERT INTO auto_starts (at) VALUES (?)').run(now);
      }
      return decision;
    },

    requestApproval(input) {
      const approval: Approval = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), state: 'pending' };
      db()
        .prepare('INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          approval.id,
          approval.requestedBy,
          approval.action,
          approval.projectId,
          approval.summary,
          approval.detail,
          approval.createdAt,
          approval.state,
        );
      ctx.bus.emit({ type: 'approval.created', approval });
      services.notify?.approval(approval);
      return approval;
    },

    waitForDecision(approvalId, timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS) {
      const approval = getApproval(approvalId);
      if (!approval) return Promise.reject(new HttpError(404, 'unknown approval'));
      if (approval.state !== 'pending') return Promise.resolve(approval.state === 'approved');
      return new Promise((resolve) => {
        const timer = setTimeout(() => settle(approvalId, 'rejected'), timeoutMs);
        timer.unref();
        const list = waiters.get(approvalId) ?? [];
        list.push((approved) => {
          clearTimeout(timer);
          resolve(approved);
        });
        waiters.set(approvalId, list);
      });
    },

    approvals() {
      const rows = db().prepare('SELECT * FROM approvals ORDER BY created_at DESC LIMIT 200').all() as Row[];
      return rows.map(toApproval);
    },

    decideApproval(id, approve) {
      const approval = getApproval(id);
      if (!approval) throw new HttpError(404, 'unknown approval');
      if (approval.state !== 'pending') throw new HttpError(409, `approval already ${approval.state}`);
      return settle(id, approve ? 'approved' : 'rejected');
    },

    log(input) {
      const entry: ActivityEntry = {
        ...input,
        id: randomUUID(),
        at: new Date().toISOString(),
        undo: input.undo ?? null,
      };
      db()
        .prepare('INSERT INTO activity (id, at, actor, action, detail, undo) VALUES (?, ?, ?, ?, ?, ?)')
        .run(
          entry.id,
          entry.at,
          entry.actor,
          entry.action,
          entry.detail,
          entry.undo ? JSON.stringify(entry.undo) : null,
        );
      ctx.bus.emit({ type: 'activity', entry });
      return entry;
    },

    activity(limit = 100) {
      const n = Math.min(Math.max(1, Math.floor(limit) || 100), 1000);
      return (db().prepare('SELECT * FROM activity ORDER BY seq DESC LIMIT ?').all(n) as Row[]).map(toEntry);
    },

    rightsFor,

    undo(id, actor) {
      const row = db().prepare('SELECT * FROM activity WHERE id = ?').get(id) as Row | undefined;
      if (!row) throw new HttpError(404, 'unknown activity entry');
      const entry = toEntry(row);
      if (!entry.undo) throw new HttpError(409, 'nothing to undo');
      applyUndo(services, entry.undo as UndoAction, actor);
      db().prepare('UPDATE activity SET undo = NULL WHERE id = ?').run(id);
      ctx.bus.emit({ type: 'projects.changed' });
      return service.log({ actor, action: 'undo', detail: `${entry.action}: ${entry.detail}` });
    },
  };

  const module: ShubModule = {
    name: 'permissions',
    routes(router) {
      router.add(ROUTES.approvals, (req) => {
        requireRight(req.caller, 'read');
        return service.approvals();
      });
      router.add(ROUTES.approvalDecide, async (req) => {
        // Approvals put a human in the loop. Sessions can read the access token the CLI signs in with, so only a signed-in
        // browser or phone (kind user) decides.
        if (req.caller.kind !== 'user') throw new HttpError(403, 'only you can decide approvals');
        const body = await req.json<{ approve?: unknown }>();
        if (typeof body?.approve !== 'boolean') throw new HttpError(400, 'approve must be a boolean');
        return service.decideApproval(req.params.id, body.approve);
      });
      router.add(ROUTES.activity, (req) => {
        requireRight(req.caller, 'read');
        return service.activity(Number(req.query.get('limit') ?? 100));
      });
      router.add(ROUTES.undo, (req) => {
        requireUser(req.caller);
        return service.undo(req.params.id, req.caller.id);
      });
    },
  };
  return { module, service };
}

export interface PermissionsExtra {
  undo(activityId: string, actor: string): ActivityEntry;
}

function applyUndo(services: Services, undo: UndoAction, actor: string): void {
  switch (undo.kind) {
    case 'project.add':
      services.config.update((c) => {
        c.projects = c.projects.filter((p) => p.id !== undo.payload.projectId);
      }, actor);
      return;
    case 'project.update':
      services.config.update((c) => {
        const project = c.projects.find((p) => p.id === undo.payload.projectId);
        if (!project) throw new HttpError(409, 'project no longer exists');
        Object.assign(project, undo.payload.previous, { id: project.id });
      }, actor);
      return;
    default:
      throw new HttpError(400, `cannot undo ${(undo as { kind: string }).kind}`);
  }
}
