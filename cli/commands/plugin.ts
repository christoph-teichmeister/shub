// `shub plugin add|list|remove|enable`: install plugins from git, manage them through the running server.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { PluginInfo } from '../../shared/api.ts';
import { createContext } from '../../server/context.ts';
import { isRight } from '../../server/permissions/rules.ts';
import { MANIFEST_FILE, NAME_RE, validateManifest } from '../../server/plugins/manifest.ts';
import { api, baseUrl, CliError, output, parse, table } from './lib/client.ts';

export const summary = 'Install, list, enable and remove plugins.';
export const usage = [
  'shub plugin add <git-url>                   clone and validate a plugin (installed disabled, no rights)',
  'shub plugin list                            installed plugins with their rights',
  'shub plugin enable <name> [--grant a,b]     enable it and grant rights it requested',
  'shub plugin update [name]                   pull the newest version of one or all plugins and restart them',
  'shub plugin remove <name>                   stop it and delete its folder (asks first)',
].join('\n');

const pluginsDir = () => join(createContext().paths.configDir, 'plugins');

async function reachable(): Promise<boolean> {
  try {
    return (await fetch(`${baseUrl()}/api/health`)).ok;
  } catch {
    return false;
  }
}

function checkName(name: string | undefined): string {
  if (!name || !NAME_RE.test(name)) throw new CliError('which plugin? Pass its name (see "shub plugin list").');
  return name;
}

async function add(url: string | undefined, json: boolean): Promise<void> {
  if (!url || url.startsWith('-')) throw new CliError('usage: shub plugin add <git-url>');
  const dir = pluginsDir();
  mkdirSync(dir, { recursive: true });
  // A dot folder is never picked up by the server, so a half-cloned plugin cannot start.
  const tmp = join(dir, `.tmp-${process.pid}-${Date.now()}`);
  let name: string;
  let rights: string[];
  try {
    execFileSync('git', ['clone', '--depth', '1', '--', url, tmp], { stdio: ['ignore', 'ignore', 'inherit'] });
    const file = join(tmp, MANIFEST_FILE);
    if (!existsSync(file)) throw new CliError(`the repository has no ${MANIFEST_FILE}`);
    let manifest;
    try {
      manifest = validateManifest(JSON.parse(readFileSync(file, 'utf8')));
    } catch (err) {
      throw new CliError((err as Error).message);
    }
    ({ name, rights } = manifest);
    if (existsSync(join(dir, name))) throw new CliError(`plugin "${name}" is already installed`);
    renameSync(tmp, join(dir, name));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (await reachable()) await api('PATCH', `/api/plugins/${name}`, { enabled: false, grantedRights: [] });
  output({ name, requestedRights: rights }, json, () =>
    [
      `Installed ${name} (disabled, no rights granted).`,
      `It requests: ${rights.join(', ') || 'no rights'}`,
      `Read its code in ${join(dir, name)}, then enable it:`,
      `  shub plugin enable ${name}${rights.length ? ` --grant ${rights.join(',')}` : ''}`,
    ].join('\n'),
  );
}

async function list(json: boolean): Promise<void> {
  const plugins = await api<PluginInfo[]>('GET', '/api/plugins');
  output(plugins, json, () =>
    plugins.length === 0
      ? 'No plugins installed. Add one with: shub plugin add <git-url>'
      : table([
          ['NAME', 'VERSION', 'STATE', 'GRANTED', 'REQUESTED'],
          ...plugins.map((p) => [
            p.name,
            p.version,
            p.enabled ? (p.running ? 'running' : 'enabled, not running') : 'disabled',
            p.grantedRights.join(',') || '-',
            p.requestedRights.join(',') || '-',
          ]),
        ]),
  );
}

async function enable(name: string, grant: string | true | undefined, json: boolean): Promise<void> {
  const body: { enabled: true; grantedRights?: string[] } = { enabled: true };
  if (typeof grant === 'string') {
    const rights = grant
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    const unknown = rights.filter((r) => !isRight(r));
    if (unknown.length) throw new CliError(`unknown rights: ${unknown.join(', ')}`);
    body.grantedRights = rights;
  } else if (grant === true) throw new CliError('--grant needs a comma-separated list of rights');
  const info = await api<PluginInfo>('PATCH', `/api/plugins/${name}`, body);
  const missing = info.requestedRights.filter((r) => !info.grantedRights.includes(r));
  output(info, json, () =>
    [
      `Enabled ${name}${info.running ? ' (running)' : ''}. Granted: ${info.grantedRights.join(', ') || 'none'}`,
      ...(missing.length ? [`Not granted: ${missing.join(', ')}`] : []),
      `Logs: GET /api/plugins/${name}/logs or Settings > Plugins.`,
    ].join('\n'),
  );
}

async function update(name: string | undefined, json: boolean): Promise<void> {
  const names = name
    ? [checkName(name)]
    : (await api<PluginInfo[]>('GET', '/api/plugins')).filter((p) => p.source).map((p) => p.name);
  const updated: PluginInfo[] = [];
  for (const n of names) updated.push(await api<PluginInfo>('POST', `/api/plugins/${n}/upgrade`));
  output(updated, json, () =>
    updated.length
      ? updated.map((p) => `${p.name}: ${p.version}${p.running ? ' (running)' : ''}`).join('\n')
      : 'No plugins from git.',
  );
}

async function remove(name: string, json: boolean): Promise<void> {
  const dir = join(pluginsDir(), name);
  if (!existsSync(dir)) throw new CliError(`plugin "${name}" is not installed`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Remove plugin ${name} and delete ${dir}? [y/N] `);
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) return console.log('Nothing removed.');
  if (await reachable()) await api('DELETE', `/api/plugins/${name}`);
  else rmSync(dir, { recursive: true, force: true }); // its config entry is ignored without the folder
  output({ removed: name }, json, () => `Removed ${name}.`);
}

export async function run(args: string[], opts: { json: boolean }): Promise<void> {
  const { positional, flags } = parse(args, ['grant']);
  const [sub, arg] = positional;
  switch (sub) {
    case 'add':
      return add(arg, opts.json);
    case 'list':
    case undefined:
      return list(opts.json);
    case 'enable':
      return enable(checkName(arg), flags.grant, opts.json);
    case 'update':
      return update(arg, opts.json);
    case 'remove':
      return remove(checkName(arg), opts.json);
    default:
      throw new CliError(`unknown subcommand "${sub}".\n${usage}`);
  }
}
