// Claude Code hooks: the per-session settings file and the route the hook script reports to.
import { join } from 'node:path';
import { ROUTES } from '../../shared/api.ts';
import { HttpError } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services } from '../services.ts';
import { isPermissionMode } from '../sessions/launch.ts';
import { HOOK_EVENTS, isHookEvent, newClaudeSessionId, transition } from './transition.ts';

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Content of `--settings <file>`: shub's hooks, so the user's own settings stay untouched, plus deny rules
 * that keep Claude's file tools out of stateDir (access token, client tokens, VAPID key).
 */
export function hookSettings(appDir: string, stateDir: string): object {
  const script = shellQuote(join(appDir, 'server', 'hooks', 'report.sh'));
  const hooks = Object.fromEntries(
    HOOK_EVENTS.map((event) => [
      event,
      [{ hooks: [{ type: 'command', command: `sh ${script} ${event}`, timeout: 5 }] }],
    ]),
  );
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
            return { ok: true };
          }
          const change = transition(session.status, req.params.event, payload);
          if (!change) return { ok: true };
          services.sessions.setStatus(session.id, change.status, change.pendingPermission);
          const updated = services.sessions.get(session.id) ?? session;
          if (change.notify?.kind === 'yourTurn') services.notify.yourTurn(updated);
          if (change.notify?.kind === 'needsYou') services.notify.needsYou(updated, change.notify.text);
          return { ok: true };
        });
      },
    },
  };
}
