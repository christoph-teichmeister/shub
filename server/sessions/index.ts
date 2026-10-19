// Sessions module: HTTP routes, terminal WebSockets and startup restore around SessionsService.
import type { ServerResponse } from 'node:http';
import { ROUTES, type SessionKind, type SessionLink, type StartSessionRequest } from '../../shared/api.ts';
import { HttpError, requireRight, requireUser, sendJson, type Caller, type Router } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services } from '../services.ts';
import { buttonPrompt, isSimpleInput } from './launch.ts';
import { SessionsService, type SessionsOptions } from './service.ts';
import { attachTerminals } from './terminal.ts';

const KINDS: SessionKind[] = ['claude', 'shell', 'global'];
const optionalString = (v: unknown): boolean => v === undefined || typeof v === 'string';

function parseStart(body: Partial<StartSessionRequest>): StartSessionRequest {
  const fields = [body.name, body.buttonId, body.input, body.prompt, body.parentId, body.cwd];
  if (!KINDS.includes(body.kind as SessionKind) || !fields.every(optionalString)) {
    throw new HttpError(400, 'invalid session request');
  }
  if (body.buttonId && body.prompt) throw new HttpError(400, 'give either buttonId or prompt');
  if (body.kind === 'shell' && !body.parentId) throw new HttpError(400, 'shells need a parentId');
  if (body.cwd && body.kind !== 'shell') throw new HttpError(400, 'cwd is only for shells');
  return { ...body, projectId: typeof body.projectId === 'string' ? body.projectId : null } as StartSessionRequest;
}

const isUser = (caller: Caller): boolean => caller.kind === 'user' || caller.kind === 'cli';

async function startRoute(
  sessions: SessionsService,
  services: Services,
  caller: Caller,
  body: unknown,
  res: ServerResponse,
) {
  const request = parseStart(body as Partial<StartSessionRequest>);
  const project = request.projectId ? services.config.project(request.projectId) : undefined;
  const button = request.buttonId ? project?.buttons.find((b) => b.id === request.buttonId) : undefined;
  const decision = services.permissions.decide(caller, {
    kind: 'session.start',
    request,
    viaButton: !!request.buttonId,
    simpleInput: isSimpleInput(request.input),
  });
  if (decision.outcome === 'deny') throw new HttpError(403, decision.reason);
  if (decision.outcome === 'allow') return sessions.start(request, caller.id);

  const approval = services.permissions.requestApproval({
    requestedBy: caller.id,
    action: 'session.start',
    projectId: request.projectId,
    summary: `Start ${button ? `"${button.label}"` : 'a session'} in ${project?.name ?? 'global'} (${decision.reason})`,
    detail: button ? buttonPrompt(button, request.input) : (request.prompt ?? ''),
  });
  services.permissions
    .waitForDecision(approval.id)
    .then(async (approved) => {
      if (approved) await sessions.start(request, caller.id);
    })
    .catch((err) => console.error('shub: approved session start failed', err));
  sendJson(res, 202, { approval });
}

function routes(sessions: SessionsService, services: Services, router: Router): void {
  router.add(ROUTES.sessions, (req) => {
    requireRight(req.caller, 'read');
    return sessions.list();
  });
  router.add(ROUTES.restorable, (req) => {
    requireRight(req.caller, 'read');
    return sessions.restorable();
  });
  router.add(ROUTES.restore, async (req) => {
    requireUser(req.caller);
    const { ids } = await req.json<{ ids?: unknown }>();
    if (!Array.isArray(ids) || !ids.every((i) => typeof i === 'string')) throw new HttpError(400, 'ids: string[]');
    return sessions.restore(ids, req.caller.id);
  });
  router.add(ROUTES.sessionStart, async (req, res) =>
    startRoute(sessions, services, req.caller, await req.json(), res),
  );
  router.add(ROUTES.sessionUpdate, async (req) => {
    // The user, or a session renaming itself.
    if (!isUser(req.caller) && req.caller.id !== `session:${req.params.id}`) throw new HttpError(403, 'not yours');
    const { name } = await req.json<{ name?: unknown }>();
    if (typeof name !== 'string') throw new HttpError(400, 'name: string');
    return sessions.rename(req.params.id, name, req.caller.id);
  });
  router.add(ROUTES.sessionClose, (req) => {
    requireUser(req.caller);
    sessions.close(req.params.id, req.caller.id);
    return { ok: true };
  });
  router.add(ROUTES.sessionPause, (req) => {
    requireUser(req.caller);
    return sessions.pause(req.params.id, req.caller.id);
  });
  router.add(ROUTES.sessionResume, (req) => {
    requireUser(req.caller);
    return sessions.resume(req.params.id, req.caller.id);
  });
  router.add(ROUTES.sessionKeys, async (req) => {
    requireUser(req.caller);
    const { keys } = await req.json<{ keys?: unknown }>();
    sessions.sendKeys(req.params.id, (Array.isArray(keys) ? keys : [keys]) as string[]);
    return { ok: true };
  });
  router.add(ROUTES.sessionPaste, async (req) => {
    requireUser(req.caller);
    const type = req.raw.headers['content-type'] ?? '';
    if (type.startsWith('application/json')) {
      const { text } = await req.json<{ text?: unknown }>();
      if (typeof text !== 'string') throw new HttpError(400, 'text: string');
      sessions.pasteText(req.params.id, text);
      return { ok: true };
    }
    if (type.startsWith('text/plain')) {
      sessions.pasteText(req.params.id, (await req.body()).toString('utf8'));
      return { ok: true };
    }
    return { path: sessions.pasteFile(req.params.id, type, await req.body()) };
  });
  router.add(ROUTES.sessionLink, async (req) => {
    const decision = services.permissions.decide(req.caller, { kind: 'session.link', sessionId: req.params.id });
    if (decision.outcome !== 'allow') throw new HttpError(403, decision.reason);
    const link = await req.json<Partial<SessionLink>>();
    if (typeof link.label !== 'string' || typeof link.url !== 'string' || !/^https?:\/\//.test(link.url)) {
      throw new HttpError(400, 'link needs label and an http(s) url');
    }
    return sessions.addLink(req.params.id, { source: req.caller.id, label: link.label.slice(0, 100), url: link.url });
  });
  router.add(ROUTES.oldSessions, (req) => {
    requireRight(req.caller, 'read');
    return sessions.oldSessions(req.params.id);
  });
}

export function create(
  ctx: Context,
  services: Services,
  options: SessionsOptions = {},
): { module: ShubModule; service: SessionsService } {
  const sessions = new SessionsService(ctx, services, options);
  sessions.init();
  return {
    module: {
      name: 'sessions',
      routes: (router) => routes(sessions, services, router),
      attach: (server) => attachTerminals(server, sessions),
      start: () => sessions.startup(),
      stop: () => sessions.stop(),
    },
    service: sessions,
  };
}
