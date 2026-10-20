// Claude Code hooks: the per-session settings file and the route the hook script reports to.
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { ROUTES } from '../../shared/api.ts';
import { HttpError } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services } from '../services.ts';
import { guard, type GuardInput } from '../projects/main-checkout.ts';
import { listWorktrees } from '../projects/worktrees.ts';
import { isPermissionMode } from '../sessions/launch.ts';
import { HOOK_EVENTS, isHookEvent, newClaudeSessionId, transition } from './transition.ts';

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * An installed app lives in <home>/versions/<version>/ next to <home>/current. Hooks go through current, so a
 * session started before an update keeps working after the update removes its old version.
 */
export function stableAppDir(appDir: string): string {
  const dir = resolve(appDir);
  const current = join(dir, '..', '..', 'current');
  return basename(dirname(dir)) === 'versions' && existsSync(current) ? current : dir;
}

/**
 * Content of `--settings <file>`: shub's hooks, so the user's own settings stay untouched, plus deny rules
 * that keep Claude's file tools out of stateDir (access token, client tokens, VAPID key).
 */
export function hookSettings(appDir: string, stateDir: string): object {
  appDir = stableAppDir(appDir);
  const script = shellQuote(join(appDir, 'server', 'hooks', 'report.sh'));
  const hooks: Record<string, object[]> = Object.fromEntries(
    HOOK_EVENTS.map((event) => [
      event,
      [{ hooks: [{ type: 'command', command: `sh ${script} ${event}`, timeout: 5 }] }],
    ]),
  );
  // Asks shub on every call, so a main checkout protected after the session started is covered too.
  const guard = shellQuote(join(appDir, 'server', 'hooks', 'guard.sh'));
  hooks.PreToolUse = [
    {
      matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit',
      hooks: [{ type: 'command', command: `sh ${guard}`, timeout: 5 }],
    },
  ];
  // "//" marks an absolute path in Claude's permission rules. Reading stays allowed for the rest of
  // stateDir, because pasted images live in <stateDir>/pastes and Claude reads them from there.
  const dir = `/${stateDir.replace(/\/+$/, '')}`;
  const deny = [
    ...['token', 'shub.db*', 'vapid.json'].map((file) => `Read(${dir}/${file})`),
    `Edit(${dir}/**)`,
    `Write(${dir}/**)`,
  ];
  return { hooks, permissions: { deny } };
}

export function create(_ctx: Context, services: Services): { module: ShubModule } {
  return {
    module: {
      name: 'hooks',
      routes(router) {
        router.add(ROUTES.guard, async (req) => {
          const sessionId = /^session:(.+)$/.exec(req.caller.id)?.[1];
          const session = sessionId ? services.sessions.get(sessionId) : undefined;
          if (!session) throw new HttpError(403, 'the guard only answers shub sessions');
          const project = session.projectId ? services.config.project(session.projectId) : undefined;
          if (!project?.mainCheckout) return {};
          const input = await req.json<GuardInput>();
          const trees = (await listWorktrees(project.path)).map((w) => w.path);
          const reason = guard(project.path, trees, project.mainCheckout.branch, input);
          if (!reason) return {};
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: reason,
            },
          };
        });
        router.add(ROUTES.hook, async (req) => {
          const sessionId = /^session:(.+)$/.exec(req.caller.id)?.[1];
          const session = sessionId ? services.sessions.get(sessionId) : undefined;
          if (!session) throw new HttpError(403, 'hooks only come from shub sessions');
          if (!isHookEvent(req.params.event)) throw new HttpError(404, 'unknown hook event');
          const payload = await req.json<Record<string, unknown>>();
          if (isPermissionMode(payload.permission_mode)) {
            services.sessions.setPermissionMode(session.id, payload.permission_mode);
          }
          if (req.params.event === 'SessionStart') {
            const claudeSessionId = newClaudeSessionId(session.claudeSessionId, payload);
            if (claudeSessionId) services.sessions.setClaudeSessionId(session.id, claudeSessionId);
            services.sessions.started(session.id);
            return { ok: true };
          }
          // A session started without a prompt is "Session N" until its first prompt names it.
          const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
          const fromUser = payload.source === undefined || payload.source === 'user';
          if (req.params.event === 'UserPromptSubmit' && fromUser && prompt && /^Session \d+$/.test(session.name)) {
            services.sessions.nameFromPrompt(session.id, prompt);
          }
          const change = transition(session.status, req.params.event, payload, !!session.waitingFor);
          if (!change) return { ok: true };
          services.sessions.setStatus(
            session.id,
            change.status,
            change.pendingPermission,
            change.pendingCommands,
            change.background,
            change.shells,
          );
          const updated = services.sessions.get(session.id) ?? session;
          if (change.notify?.kind === 'yourTurn') services.notify.yourTurn(updated);
          if (change.notify?.kind === 'needsYou') services.notify.needsYou(updated, change.notify.text);
          return { ok: true };
        });
      },
    },
  };
}
