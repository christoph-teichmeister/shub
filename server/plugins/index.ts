// Plugins: discovery under <configDir>/plugins/<name>/, one supervised process per enabled plugin,
// sidebar sections they push, and actions the user clicks forwarded as events.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginInfo, PluginManifest, Right, SidebarSectionContent } from '../../shared/api.ts';
import { ROUTES } from '../../shared/api.ts';
import { HttpError, requireUser, type Caller } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Plugins, Services } from '../services.ts';
import { isRight } from '../permissions/rules.ts';
import { MANIFEST_FILE, MAX_STRING, NAME_RE, sanitizeSection, SectionError, validateManifest } from './manifest.ts';
import { PluginProcess } from './supervisor.ts';

interface Installed {
  manifest: PluginManifest;
  dir: string;
  source: string;
}

export function readSource(dir: string): string {
  try {
    const git = readFileSync(join(dir, '.git', 'config'), 'utf8');
    return /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(git)?.[1] ?? '';
  } catch {
    return '';
  }
}

export function discover(pluginsDir: string): Map<string, Installed> {
  const found = new Map<string, Installed>();
  if (!existsSync(pluginsDir)) return found;
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !NAME_RE.test(entry.name)) continue;
    const dir = join(pluginsDir, entry.name);
    try {
      const manifest = validateManifest(JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8')));
      if (manifest.name !== entry.name) throw new Error(`folder name differs from manifest name "${manifest.name}"`);
      found.set(manifest.name, { manifest, dir, source: readSource(dir) });
    } catch (err) {
      console.warn(`shub: skipping plugin ${entry.name}: ${(err as Error).message}`);
    }
  }
  return found;
}

function pluginName(value: string): string {
  if (!NAME_RE.test(value)) throw new HttpError(400, 'invalid plugin name');
  return value;
}

export function create(ctx: Context, services: Services): { module: ShubModule; service: Plugins } {
  const pluginsDir = join(ctx.paths.configDir, 'plugins');
  const running = new Map<string, PluginProcess>();
  const sections = new Map<string, Map<string, SidebarSectionContent>>();
  // Logs outlive a stopped process so a crash on enable can still be read.
  const logs = new Map<string, string[]>();
  let unsubscribe: (() => void) | null = null;

  const entryFor = (name: string) => services.config.get().plugins.find((p) => p.name === name);
  const granted = (name: string, manifest: PluginManifest): Right[] =>
    (entryFor(name)?.grantedRights ?? []).filter((r) => manifest.rights.includes(r));

  function installed(name: string): Installed {
    const plugin = discover(pluginsDir).get(name);
    if (!plugin) throw new HttpError(404, 'unknown plugin');
    return plugin;
  }

  function info(name: string, plugin: Installed): PluginInfo {
    const { manifest } = plugin;
    const pushed = sections.get(name);
    return {
      name,
      version: manifest.version,
      ...(manifest.description !== undefined && { description: manifest.description }),
      source: plugin.source,
      enabled: entryFor(name)?.enabled ?? false,
      running: running.get(name)?.running ?? false,
      requestedRights: manifest.rights,
      grantedRights: granted(name, manifest),
      sections: (manifest.contributes?.sidebarSections ?? []).map((s) => ({
        ...s,
        content: pushed?.get(s.id) ?? null,
      })),
      sessionMenuActions: manifest.contributes?.sessionMenuActions ?? [],
      settingsActions: manifest.contributes?.settingsActions ?? [],
    };
  }

  function launch(name: string, plugin: Installed): PluginProcess {
    const proc = new PluginProcess({
      name,
      dir: plugin.dir,
      command: plugin.manifest.start,
      env: () => {
        // Auth resolves the rights from config on every request, so granting needs no restart.
        const rights = granted(name, plugin.manifest);
        const token = services.auth.issueClientToken({ kind: 'plugin', id: `plugin:${name}`, rights });
        return {
          vars: { SHUB_URL: `http://${ctx.host}:${ctx.port}`, SHUB_TOKEN: token, SHUB_PLUGIN_NAME: name },
          release: () => services.auth.revokeClientToken(token),
        };
      },
    });
    logs.set(name, proc.logs);
    proc.start();
    return proc;
  }

  // Serialised: config.changed and PATCH both trigger it.
  let chain = Promise.resolve();
  const reconcile = (): Promise<void> => (chain = chain.then(reconcileNow, reconcileNow));

  /** Bring running processes in line with config: start enabled ones, stop disabled or removed ones. */
  async function reconcileNow(): Promise<void> {
    const found = discover(pluginsDir);
    for (const [name, proc] of running) {
      if (found.has(name) && entryFor(name)?.enabled) continue;
      running.delete(name);
      sections.delete(name);
      await proc.stop();
    }
    for (const [name, plugin] of found) {
      if (running.has(name) || !entryFor(name)?.enabled) continue;
      running.set(name, launch(name, plugin));
    }
    ctx.bus.emit({ type: 'plugins.changed' });
  }

  async function update(caller: Caller, name: string, body: { enabled?: unknown; grantedRights?: unknown }) {
    const plugin = installed(name);
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean')
      throw new HttpError(400, 'enabled must be a boolean');
    let rights: Right[] | undefined;
    if (body.grantedRights !== undefined) {
      if (!Array.isArray(body.grantedRights) || !body.grantedRights.every(isRight)) {
        throw new HttpError(400, 'grantedRights must be an array of rights');
      }
      const extra = body.grantedRights.filter((r) => !plugin.manifest.rights.includes(r));
      if (extra.length) throw new HttpError(400, `not requested by the manifest: ${extra.join(', ')}`);
      rights = [...new Set(body.grantedRights)];
    }
    services.config.update((c) => {
      let entry = c.plugins.find((p) => p.name === name);
      if (!entry) c.plugins.push((entry = { name, enabled: false, grantedRights: [] }));
      if (body.enabled !== undefined) entry.enabled = body.enabled as boolean;
      if (rights) entry.grantedRights = rights;
    }, caller.id);
    const entry = entryFor(name)!;
    services.permissions.log({
      actor: caller.id,
      action: 'plugin.update',
      detail: `${name}: ${entry.enabled ? 'enabled' : 'disabled'}, rights: ${entry.grantedRights.join(', ') || 'none'}`,
    });
    await reconcile();
    return info(name, plugin);
  }

  async function remove(caller: Caller, name: string) {
    const plugin = installed(name);
    const run = running.get(name);
    running.delete(name);
    sections.delete(name);
    await run?.stop();
    services.config.update((c) => {
      c.plugins = c.plugins.filter((p) => p.name !== name);
    }, caller.id);
    rmSync(plugin.dir, { recursive: true, force: true });
    logs.delete(name);
    services.permissions.log({ actor: caller.id, action: 'plugin.remove', detail: name });
    ctx.bus.emit({ type: 'plugins.changed' });
    return { ok: true };
  }

  function putSection(caller: Caller, name: string, sectionId: string, body: unknown) {
    if (caller.id !== `plugin:${name}`) throw new HttpError(403, 'a plugin may only fill its own sections');
    const decision = services.permissions.decide(caller, { kind: 'ui.contribute' });
    if (decision.outcome !== 'allow') throw new HttpError(403, decision.reason);
    const declared = installed(name).manifest.contributes?.sidebarSections ?? [];
    if (!declared.some((s) => s.id === sectionId)) throw new HttpError(404, 'section not declared in the manifest');
    let content: SidebarSectionContent;
    try {
      content = sanitizeSection(body);
    } catch (err) {
      if (err instanceof SectionError) throw new HttpError(400, err.message);
      throw err;
    }
    if (!sections.has(name)) sections.set(name, new Map());
    sections.get(name)!.set(sectionId, content);
    ctx.bus.emit({ type: 'plugins.changed' });
    return content;
  }

  function action(caller: Caller, name: string, actionId: string, body: unknown) {
    if (caller.kind !== 'user') throw new HttpError(403, 'plugin actions are clicked by you');
    const contributes = installed(name).manifest.contributes;
    const declared = [...(contributes?.sessionMenuActions ?? []), ...(contributes?.settingsActions ?? [])];
    if (!declared.some((a) => a.id === actionId)) throw new HttpError(404, 'action not declared in the manifest');
    const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const context: { sessionId?: string; projectId?: string; entryId?: string } = {};
    for (const key of ['sessionId', 'projectId', 'entryId'] as const) {
      // Same cap as section entry ids.
      if (typeof raw[key] === 'string') context[key] = raw[key].slice(0, MAX_STRING);
    }
    ctx.bus.emit({ type: 'plugin.action', plugin: name, actionId, context });
    return { ok: true };
  }

  const module: ShubModule = {
    name: 'plugins',
    routes(router) {
      router.add(ROUTES.plugins, () => [...discover(pluginsDir)].map(([name, p]) => info(name, p)));
      router.add(ROUTES.pluginUpdate, async (req) => {
        requireUser(req.caller);
        return update(req.caller, pluginName(req.params.name), (await req.json()) ?? {});
      });
      router.add(ROUTES.pluginRemove, (req) => {
        requireUser(req.caller);
        return remove(req.caller, pluginName(req.params.name));
      });
      router.add(ROUTES.pluginSection, async (req) =>
        putSection(req.caller, pluginName(req.params.name), req.params.sectionId, await req.json()),
      );
      router.add(ROUTES.pluginAction, async (req) => {
        const body = await req.json().catch(() => ({}));
        return action(req.caller, pluginName(req.params.name), req.params.actionId, body);
      });
      router.add(ROUTES.pluginLogs, (req) => {
        requireUser(req.caller);
        return { lines: logs.get(pluginName(req.params.name)) ?? [] };
      });
    },
    async start() {
      unsubscribe = ctx.bus.on((e) => {
        if (e.type === 'config.changed') void reconcile();
      });
      await reconcile();
    },
    async stop() {
      unsubscribe?.();
      await Promise.all([...running.values()].map((proc) => proc.stop()));
      running.clear();
    },
  };
  const service: Plugins = {
    requestedRights(name) {
      if (!NAME_RE.test(name)) return [];
      try {
        return validateManifest(JSON.parse(readFileSync(join(pluginsDir, name, MANIFEST_FILE), 'utf8'))).rights;
      } catch {
        return [];
      }
    },
  };
  return { module, service };
}
