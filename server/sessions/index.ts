// Sessions module: HTTP routes, terminal WebSockets and startup restore around SessionsService.
import { createReadStream } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { ROUTES, type SessionKind, type SessionLink, type StartSessionRequest } from '../../shared/api.ts';
import { HttpError, requireRight, requireUser, sendJson, type Caller, type Router } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services } from '../services.ts';
import { listWorktrees } from '../projects/worktrees.ts';
import { viewableImage } from './image.ts';
import { buttonPrompt, isSimpleInput } from './launch.ts';
import { FILE_PASTE_MAX, NAMED_KEYS, SessionsService, type SessionsOptions } from './service.ts';
import { attachTerminals } from './terminal.ts';

const KINDS: SessionKind[] = ['claude', 'shell', 'global'];
const optionalString = (v: unknown): boolean => v === undefined || typeof v === 'string';

function parseStart(body: Partial<StartSessionRequest>): StartSessionRequest {
  const fields = [
    body.name,
    body.buttonId,
    body.input,
    body.prompt,
    body.parentId,
    body.cwd,
    body.resumeClaudeSessionId,
  ];
  if (!KINDS.includes(body.kind as SessionKind) || !fields.every(optionalString)) {
    throw new HttpError(400, 'invalid session request');
  }
  if (body.buttonId && body.prompt) throw new HttpError(400, 'give either buttonId or prompt');
  if (body.kind === 'shell' && !body.parentId && !body.cwd && !body.projectId) {
    throw new HttpError(400, 'shells need a parentId, a cwd or a project');
  }
  if (body.cwd && body.kind === 'global') throw new HttpError(400, 'the global Claude takes no cwd');
  if (body.resumeClaudeSessionId !== undefined) {
    if (body.kind !== 'claude') throw new HttpError(400, 'only claude sessions can resume a conversation');
    if (body.buttonId || body.prompt || body.input) throw new HttpError(400, 'a resumed session takes no prompt');
  }
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
  // Without a parent, a cwd must lie inside one of the project's worktrees (the main checkout included).
  if (request.cwd && !request.parentId) {
    if (!project) throw new HttpError(400, 'a cwd needs a project');
    const cwd = request.cwd;
    if (!(await listWorktrees(project.path)).some((w) => cwd === w.path || cwd.startsWith(`${w.path}/`)))
      throw new HttpError(400, `not inside a worktree of ${project.name}: ${cwd}`);
  }
  const decision = services.permissions.decide(caller, {
    kind: 'session.start',
    request,
    viaButton: !!request.buttonId,
    simpleInput: isSimpleInput(request.input),
  });
  if (decision.outcome === 'deny') throw new HttpError(403, decision.reason);
  if (decision.outcome === 'allow') return sessions.start(request, caller.id, isUser(caller));

  const approval = services.permissions.requestApproval({
    requestedBy: caller.id,
    action: 'session.start',
    projectId: request.projectId,
    summary: `Start ${button ? `"${button.label}"` : 'a session'} in ${project?.name ?? 'global'} (${decision.reason})`,
    detail: button
      ? buttonPrompt(button, request.input)
      : (request.prompt ?? (request.resumeClaudeSessionId ? `resume ${request.resumeClaudeSessionId}` : '')),
  });
  services.permissions
    .waitForDecision(approval.id)
    .then(async (approved) => {
      if (approved) await sessions.start(request, caller.id);
    })
    .catch((err) => console.error('shub: approved session start failed', err));
  sendJson(res, 202, { approval });
}

function routes(sessions: SessionsService, services: Services, router: Router, stateDir: string): void {
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
  router.add(ROUTES.sessionClaudeHere, async (req, res) => {
    const shell = sessions.get(req.params.id);
    if (shell?.kind !== 'shell') throw new HttpError(404, 'no such terminal');
    const cwd = sessions.currentPath(shell.id);
    return startRoute(
      sessions,
      services,
      req.caller,
      { projectId: shell.projectId, kind: 'claude', cwd, from: shell.id },
      res,
    );
  });
  router.add(ROUTES.sessionUpdate, async (req) => {
    // The user, or a session changing itself.
    if (!isUser(req.caller) && req.caller.id !== `session:${req.params.id}`) throw new HttpError(403, 'not yours');
    const body = await req.json<{
      name?: unknown;
      waitingFor?: unknown;
      waitCheck?: unknown;
      waitEveryMinutes?: unknown;
      waitOnDone?: unknown;
    }>();
    if ('waitingFor' in body) {
      const { waitingFor, waitCheck, waitEveryMinutes, waitOnDone } = body;
      if (waitingFor !== null && typeof waitingFor !== 'string') throw new HttpError(400, 'waitingFor: string | null');
      if (waitCheck !== undefined && typeof waitCheck !== 'string') throw new HttpError(400, 'waitCheck: string');
      if (waitEveryMinutes !== undefined && typeof waitEveryMinutes !== 'number') {
        throw new HttpError(400, 'waitEveryMinutes: number');
      }
      if (waitOnDone !== undefined && waitOnDone !== null && typeof waitOnDone !== 'string') {
        throw new HttpError(400, 'waitOnDone: string | null');
      }
      const before = sessions.get(req.params.id);
      const check = waitCheck ? { prompt: waitCheck, everyMinutes: waitEveryMinutes, onDone: waitOnDone } : undefined;
      const session = sessions.wait(req.params.id, waitingFor, req.caller.id, check);
      // The session ending its own wait means what it waited for happened: tell the user like a question.
      if (body.waitingFor === null && before?.status === 'waiting' && !isUser(req.caller)) {
        services.notify.needsYou(session, `Done waiting: ${before.waitingFor}`);
      }
      return session;
    }
    if (typeof body.name !== 'string') throw new HttpError(400, 'name: string');
    return sessions.rename(req.params.id, body.name, req.caller.id);
  });
  router.add(ROUTES.sessionsReorder, async (req) => {
    requireUser(req.caller);
    const { positions, tabs } = await req.json<{ positions?: unknown; tabs?: unknown }>();
    const ok =
      positions &&
      typeof positions === 'object' &&
      Object.values(positions).every((v) => v === null || (Number.isInteger(v) && (v as number) >= 0));
    if (!ok) throw new HttpError(400, 'positions: { [id]: number | null }');
    return sessions.reorder(positions as Record<string, number | null>, tabs === true);
  });
  router.add(ROUTES.sessionClose, (req) => {
    // You close any session; a session only itself (also from inside it, e.g. `shub session close`).
    const decision = services.permissions.decide(req.caller, { kind: 'session.close', sessionId: req.params.id });
    if (decision.outcome !== 'allow') throw new HttpError(403, decision.reason);
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
  router.add(ROUTES.sessionCommand, async (req) => {
    requireUser(req.caller);
    const { index, action } = await req.json<{ index?: unknown; action?: unknown }>();
    if (typeof index !== 'number' || (action !== 'run' && action !== 'dismiss')) {
      throw new HttpError(400, "index: number, action: 'run' | 'dismiss'");
    }
    sessions.answerCommand(req.params.id, index, action);
    return { ok: true };
  });
  router.add(ROUTES.sessionKeys, async (req) => {
    requireUser(req.caller);
    const { keys } = await req.json<{ keys?: unknown }>();
    const list = (Array.isArray(keys) ? keys : [keys]) as string[];
    // A prompts-level phone answers questions (1, 2, 3, Enter, Escape), it does not type text.
    if (req.caller.level === 'prompts' && !list.every((k) => NAMED_KEYS.has(k) || /^[0-9]$/.test(k))) {
      throw new HttpError(403, 'this device may only send named keys and single digits');
    }
    sessions.sendKeys(req.params.id, list);
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
    const name = decodeURIComponent(String(req.raw.headers['x-filename'] ?? ''));
    return { path: sessions.pasteFile(req.params.id, type, await req.body(FILE_PASTE_MAX), name) };
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
  router.add(ROUTES.image, (req, res) => {
    requireRight(req.caller, 'read');
    const image = viewableImage(req.query.get('path') ?? '', stateDir);
    if (!image) throw new HttpError(404, 'no image shub may show');
    res.writeHead(200, { 'content-type': image.type, 'cache-control': 'no-store' });
    createReadStream(image.file).pipe(res);
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
      routes: (router) => routes(sessions, services, router, ctx.paths.stateDir),
      attach: (server) => attachTerminals(server, sessions),
      start: () => sessions.startup(),
      stop: () => sessions.stop(),
    },
    service: sessions,
  };
}
