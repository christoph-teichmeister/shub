import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import type { ProjectIcon, ProjectView, Session } from '../../shared/api.ts';
import { api, CliError, output, parse, table } from './lib/client.ts';
import { findProject } from './lib/projects.ts';

export const summary = 'List, show or add projects.';
export const usage = `shub project list
shub project show <id|name>
shub project add <path> [--name <name>] [--group <group>] [--dormant]
shub project icon [<id|name>] auto | <symbol> [--color <css colour>] | <https url | image file>
                                     (defaults to the project of $SHUB_SESSION_ID; a data: image is capped at 4096 characters)`;

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** `auto`, an image (https URL or a small local file) or a short symbol such as "A". */
function iconFrom(value: string, color: unknown): ProjectIcon {
  if (value === 'auto') return { kind: 'auto' };
  if (value.startsWith('https://')) return { kind: 'image', path: value };
  const mime = MIME[extname(value).toLowerCase()];
  if (mime) {
    try {
      return { kind: 'image', path: `data:${mime};base64,${readFileSync(value).toString('base64')}` };
    } catch {
      throw new CliError(`cannot read ${value}`);
    }
  }
  return { kind: 'symbol', symbol: value, color: typeof color === 'string' ? color : '#f92672' };
}

export async function run(args: string[], opts: { json: boolean }): Promise<void> {
  const [sub, ...rest] = args;
  const { positional, flags } = parse(rest, ['name', 'group', 'color']);
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
  if (sub === 'icon') {
    const value = positional.pop();
    if (!value) throw new CliError(`usage:\n${usage}`);
    let ref: string | undefined = positional[0];
    if (!ref && process.env.SHUB_SESSION_ID) {
      const sessions = await api<Session[]>('GET', '/api/sessions');
      ref = sessions.find((s) => s.id === process.env.SHUB_SESSION_ID)?.projectId ?? undefined;
    }
    const p = await findProject(ref);
    const result = await api<ProjectView | { approval: { id: string } }>('PATCH', `/api/projects/${p.id}`, {
      icon: iconFrom(value, flags.color),
    });
    return output(result, opts.json, () =>
      'approval' in result ? `Waiting for approval in shub (${result.approval.id}).` : `Icon of ${p.name} set.`,
    );
  }
  throw new CliError(`unknown subcommand "${sub}"\n${usage}`);
}
