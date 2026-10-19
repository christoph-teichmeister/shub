import { resolve } from 'node:path';
import type { ProjectView } from '../../shared/api.ts';
import { api, CliError, output, parse, table } from './lib/client.ts';
import { findProject } from './lib/projects.ts';

export const summary = 'List, show or add projects.';
export const usage = `shub project list
shub project show <id|name>
shub project add <path> [--name <name>] [--group <group>] [--dormant]`;

export async function run(args: string[], opts: { json: boolean }): Promise<void> {
  const [sub, ...rest] = args;
  const { positional, flags } = parse(rest, ['name', 'group']);
  if (sub === 'list' || sub === undefined) {
    const projects = await api<ProjectView[]>('GET', '/api/projects');
    return output(projects, opts.json, () =>
      projects.length
        ? table([
            ['ID', 'NAME', 'GROUP', 'VISIBILITY', 'PATH'],
            ...projects.map((p) => [p.id, p.name, p.group, p.visibility, p.path]),
          ])
        : 'No projects yet. Add one with "shub project add <path>".',
    );
  }
  if (sub === 'show') {
    const p = await findProject(positional[0]);
    return output(p, opts.json, () =>
      [
        `${p.name} (${p.id})`,
        `  path:    ${p.path}`,
        `  group:   ${p.group || '-'}`,
        `  shown:   ${p.visibility}`,
        `  icon:    ${p.resolvedIcon.kind}`,
        `  buttons: ${p.buttons.map((b) => b.label).join(', ') || '-'}`,
      ].join('\n'),
    );
  }
  if (sub === 'add') {
    if (!positional[0]) throw new CliError(`usage:\n${usage}`);
    const path = resolve(positional[0]);
    const body = {
      path,
      name: typeof flags.name === 'string' ? flags.name : path.split('/').pop(),
      group: typeof flags.group === 'string' ? flags.group : undefined,
      visibility: flags.dormant ? 'dormant' : 'pinned',
    };
    const result = await api<ProjectView | { approval: { id: string } }>('POST', '/api/projects', body);
    return output(result, opts.json, () =>
      'approval' in result
        ? `Waiting for approval in shub (${result.approval.id}).`
        : `Added ${result.name} (${result.id}).`,
    );
  }
  throw new CliError(`unknown subcommand "${sub}"\n${usage}`);
}
