// Project, theme and settings routes on top of the config store, gated by the permission model.
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  ROUTES,
  type Approval,
  type ButtonDef,
  type Config,
  type Project,
  type ProjectIcon,
  type ThemeDef,
  type Visibility,
} from '../../shared/api.ts';
import { remoteIcon } from '../config/index.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import { HttpError, requireRight, requireUser, type Caller, type Request, type Router } from '../api/router.ts';
import type { PermissionAction, Services } from '../services.ts';
import { importCandidates } from './import.ts';

type Gated<T> = T | { approval: Approval };

interface ApprovalInfo {
  action: Approval['action'];
  projectId: string | null;
  summary: string;
  detail: string;
}

/**
 * Runs `apply` when every action is allowed; on "ask" it files one approval and applies once the user approves.
 * The most restrictive decision wins.
 */
function gate<T>(
  services: Services,
  caller: Caller,
  actions: PermissionAction[],
  info: ApprovalInfo,
  apply: () => T,
): Gated<T> {
  const decisions = actions.map((a) => services.permissions.decide(caller, a));
  const denied = decisions.find((d) => d.outcome === 'deny');
  if (denied && denied.outcome === 'deny') throw new HttpError(403, denied.reason);
  const run = () => {
    const result = apply();
    services.permissions.log({ actor: caller.id, action: info.action, detail: info.summary });
    return result;
  };
  if (!decisions.some((d) => d.outcome === 'ask')) return run();
  const approval = services.permissions.requestApproval({ requestedBy: caller.id, ...info });
  services.permissions
    .waitForDecision(approval.id)
    .then((ok) => ok && run())
    .catch((err) => console.error('shub: approved change failed', err));
  return { approval };
}

const VISIBILITIES: Visibility[] = ['pinned', 'dormant'];
const ASKS: ButtonDef['ask'][] = ['nothing', 'text', 'number', 'pick-worktree'];

function bad(message: string): never {
  throw new HttpError(400, message);
}

function str(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) bad(`${field} must be a non-empty string`);
  return value.trim();
}

function dirPath(value: unknown): string {
  const path = str(value, 'path', 4096);
  if (!isAbsolute(path)) bad('path must be absolute');
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) bad('path is not a directory');
  return resolve(path);
}

function icon(value: unknown): ProjectIcon {
  const v = value as ProjectIcon;
  if (v?.kind === 'auto') return { kind: 'auto' };
  if (v?.kind === 'symbol')
    return { kind: 'symbol', symbol: str(v.symbol, 'icon.symbol', 8), color: str(v.color, 'icon.color', 40) };
  if (v?.kind === 'image') return { kind: 'image', path: str(v.path, 'icon.path', 4096) };
  bad('icon.kind must be auto, symbol or image');
}

function buttons(value: unknown): ButtonDef[] {
  if (!Array.isArray(value)) bad('buttons must be an array');
  return value.map((b: ButtonDef, i) => {
    if (!ASKS.includes(b?.ask)) bad(`buttons[${i}].ask is invalid`);
    if (typeof b.confirm !== 'boolean') bad(`buttons[${i}].confirm must be a boolean`);
    return { ...b, id: str(b.id, `buttons[${i}].id`, 64), label: str(b.label, `buttons[${i}].label`, 80) };
  });
}

function slug(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function addGroup(config: Config, group: string): void {
  if (group && !config.groups.includes(group)) config.groups.push(group);
}

type ProjectInput = Partial<Omit<Project, 'id' | 'order'>>;

function parseProject(body: ProjectInput, partial: boolean): ProjectInput {
  const out: ProjectInput = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, 'name', 80);
  if (!partial || body.path !== undefined) out.path = dirPath(body.path);
  if (body.group !== undefined)
    out.group = typeof body.group === 'string' ? body.group.trim() : bad('group must be a string');
  if (body.visibility !== undefined) {
    out.visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : bad('visibility is invalid');
  }
  if (body.icon !== undefined) out.icon = icon(body.icon);
  if (body.buttons !== undefined) out.buttons = buttons(body.buttons);
  return out;
}

function projectRoutes(services: Services, router: Router): void {
  const config = services.config;
  const existing = (id: string): Project =>
    config.project(id) ??
    (() => {
      throw new HttpError(404, 'no such project');
    })();

  router.add(ROUTES.config, (req) => {
    requireRight(req.caller, 'read');
    return config.get();
  });
  router.add(ROUTES.projects, (req) => {
    requireRight(req.caller, 'read');
    return config.projectViews();
  });

  router.add(ROUTES.projectCreate, async (req) => {
    const input = parseProject(await req.json<ProjectInput>(), false);
    const actions: PermissionAction[] = [{ kind: 'projects.write', projectId: null }];
    return gate(
      services,
      req.caller,
      actions,
      {
        action: 'projects.write',
        projectId: null,
        summary: `Add project ${input.name}`,
        detail: JSON.stringify(input, null, 2),
      },
      () => {
        let id = '';
        config.update((c) => {
          if (c.projects.some((p) => p.path === input.path)) throw new HttpError(409, 'project with this path exists');
          id = slug(input.name!, new Set(c.projects.map((p) => p.id)));
          const order = Math.max(-1, ...c.projects.map((p) => p.order)) + 1;
          c.projects.push({
            id,
            name: input.name!,
            path: input.path!,
            group: input.group ?? '',
            visibility: input.visibility ?? 'pinned',
            order,
            icon: input.icon ?? { kind: 'auto' },
            buttons: input.buttons ?? [],
          });
          addGroup(c, input.group ?? '');
        }, req.caller.id);
        return config.projectView(id)!;
      },
    );
  });

  router.add(ROUTES.projectUpdate, async (req) => {
    const before = existing(req.params.id);
    const patch = parseProject(await req.json<ProjectInput>(), true);
    const actions: PermissionAction[] = [{ kind: 'projects.write', projectId: before.id }];
    if (patch.buttons) {
      const diff = `- ${JSON.stringify(before.buttons, null, 2)}\n+ ${JSON.stringify(patch.buttons, null, 2)}`;
      actions.push({ kind: 'buttons.write', projectId: before.id, diff });
    }
    return gate(
      services,
      req.caller,
      actions,
      {
        action: patch.buttons ? 'buttons.write' : 'projects.write',
        projectId: before.id,
        summary: `Change project ${before.name}`,
        detail: JSON.stringify(patch, null, 2),
      },
      () => {
        config.update((c) => {
          const project = c.projects.find((p) => p.id === before.id);
          if (!project) throw new HttpError(404, 'no such project');
          Object.assign(project, patch);
          addGroup(c, project.group);
        }, req.caller.id);
        return config.projectView(before.id)!;
      },
    );
  });

  router.add(ROUTES.projectDelete, (req) => {
    const project = existing(req.params.id);
    return gate(
      services,
      req.caller,
      [{ kind: 'projects.delete', projectId: project.id }],
      {
        action: 'projects.write',
        projectId: project.id,
        summary: `Remove project ${project.name}`,
        detail: project.path,
      },
      () => {
        // Only the config entry goes; the folder on disk is never touched.
        config.update((c) => void (c.projects = c.projects.filter((p) => p.id !== project.id)), req.caller.id);
        return { ok: true };
      },
    );
  });

  router.add(ROUTES.projectsReorder, async (req) => {
    const { ids } = await req.json<{ ids?: unknown }>();
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) bad('ids must be a list of project ids');
    return gate(
      services,
      req.caller,
      [{ kind: 'projects.write', projectId: null }],
      { action: 'projects.write', projectId: null, summary: 'Reorder projects', detail: ids.join('\n') },
      () => {
        config.update((c) => {
          const rank = (p: Project) => (ids.includes(p.id) ? ids.indexOf(p.id) : ids.length + p.order);
          c.projects.sort((a, b) => rank(a) - rank(b)).forEach((p, i) => (p.order = i));
        }, req.caller.id);
        return config.projectViews();
      },
    );
  });

  router.add(ROUTES.importCandidates, (req) => {
    requireUser(req.caller);
    const known = new Set(config.get().projects.map((p) => p.path));
    return importCandidates(undefined, known).map((c) => ({ ...c, resolvedIcon: remoteIcon(c.path) }));
  });
}

function settingsRoutes(services: Services, router: Router): void {
  const config = services.config;
  router.add(ROUTES.themes, async (req: Request) => {
    requireUser(req.caller);
    const id = req.params.id;
    if (!/^[a-z0-9-]{1,40}$/.test(id)) bad('theme id must match [a-z0-9-]');
    const body = await req.json<Partial<ThemeDef>>();
    if (config.get().themes.some((t) => t.id === id && t.builtIn)) bad('built-in themes cannot be changed');
    const tokens = body.tokens ?? {};
    if (typeof tokens !== 'object' || !Object.values(tokens).every((v) => typeof v === 'string')) {
      bad('tokens must map token names to CSS colours');
    }
    const theme: ThemeDef = { id, name: str(body.name, 'name', 60), builtIn: false, tokens };
    if (body.base !== undefined) theme.base = str(body.base, 'base', 40);
    config.update((c) => {
      c.themes = [...c.themes.filter((t) => t.id !== id), theme];
    }, req.caller.id);
    return theme;
  });

  router.add(ROUTES.settings, async (req) => {
    requireUser(req.caller);
    const body = await req.json<Partial<Pick<Config, 'activeTheme' | 'notifications' | 'groups'>>>();
    const current = config.get();
    if (body.activeTheme !== undefined && !current.themes.some((t) => t.id === body.activeTheme)) bad('unknown theme');
    if (body.groups !== undefined && !(Array.isArray(body.groups) && body.groups.every((g) => typeof g === 'string'))) {
      bad('groups must be a list of strings');
    }
    if (body.notifications !== undefined) {
      const known = Object.keys(current.notifications);
      for (const [k, v] of Object.entries(body.notifications)) {
        if (!known.includes(k) || typeof v !== 'boolean') bad(`notifications.${k} is invalid`);
      }
    }
    return config.update((c) => {
      if (body.activeTheme !== undefined) c.activeTheme = body.activeTheme;
      if (body.groups !== undefined) c.groups = body.groups;
      if (body.notifications !== undefined) Object.assign(c.notifications, body.notifications);
    }, req.caller.id);
  });
}

export function create(_ctx: Context, services: Services): { module: ShubModule } {
  return {
    module: {
      name: 'projects',
      routes: (router) => {
        projectRoutes(services, router);
        settingsRoutes(services, router);
      },
    },
  };
}
