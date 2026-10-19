import type { Approval, Session, StartSessionRequest } from '../../shared/api.ts';
import { api, CliError, output, parse, table } from './lib/client.ts';
import { findProject } from './lib/projects.ts';

export const summary = 'List, start or inspect sessions.';
export const usage = `shub session list [--project <id|name>]
shub session start <project|global> [--prompt <text>] [--button <id> [--input <text>]] [--name <name>] [--shell]
shub session status [<session id>]   (defaults to $SHUB_SESSION_ID inside a session)
shub session close [<session id>]    (defaults to $SHUB_SESSION_ID; a session may only close itself)`;

export async function run(args: string[], opts: { json: boolean }): Promise<void> {
  const [sub, ...rest] = args;
  const { positional, flags } = parse(rest, ['project', 'prompt', 'button', 'input', 'name']);
  if (sub === 'list' || sub === undefined) return list(flags.project, opts.json);
  if (sub === 'start') return start(positional[0], flags, opts.json);
  if (sub === 'status') return status(positional[0] ?? process.env.SHUB_SESSION_ID, opts.json);
  if (sub === 'close') return close(positional[0] ?? process.env.SHUB_SESSION_ID, opts.json);
  throw new CliError(`unknown subcommand "${sub}"\n${usage}`);
}

async function list(projectRef: string | true | undefined, json: boolean): Promise<void> {
  let sessions = await api<Session[]>('GET', '/api/sessions');
  if (typeof projectRef === 'string') {
    const project = await findProject(projectRef);
    sessions = sessions.filter((s) => s.projectId === project.id);
  }
  output(sessions, json, () =>
    sessions.length
      ? table([
          ['ID', 'NAME', 'KIND', 'STATUS', 'PROJECT'],
          ...sessions.map((s) => [s.id, s.name, s.kind, s.status, s.projectId ?? 'global']),
        ])
      : 'No sessions.',
  );
}

async function start(ref: string | undefined, flags: Record<string, string | true>, json: boolean): Promise<void> {
  if (!ref) throw new CliError(`usage:\n${usage}`);
  const global = ref === 'global';
  const request: StartSessionRequest = {
    projectId: global ? null : (await findProject(ref)).id,
    kind: global ? 'global' : flags.shell ? 'shell' : 'claude',
  };
  if (typeof flags.name === 'string') request.name = flags.name;
  if (typeof flags.prompt === 'string') request.prompt = flags.prompt;
  if (typeof flags.button === 'string') request.buttonId = flags.button;
  if (typeof flags.input === 'string') request.input = flags.input;
  if (request.prompt && request.buttonId) throw new CliError('use either --prompt or --button, not both');
  const result = await api<Session | { approval: Approval }>('POST', '/api/sessions', request);
  output(result, json, () =>
    'approval' in result
      ? `Waiting for approval in shub: ${result.approval.summary} (${result.approval.id}).`
      : `Started ${result.name} (${result.id}).`,
  );
}

async function status(id: string | undefined, json: boolean): Promise<void> {
  if (!id) throw new CliError('which session? Pass an id (see "shub session list").');
  const session = (await api<Session[]>('GET', '/api/sessions')).find((s) => s.id === id);
  if (!session) throw new CliError(`no session "${id}"`);
  output(
    session,
    json,
    () => `${session.name} (${session.id}): ${session.status}, last activity ${session.lastActivityAt}`,
  );
}

async function close(id: string | undefined, json: boolean): Promise<void> {
  if (!id) throw new CliError('which session? Pass an id (see "shub session list").');
  const result = await api<{ ok: boolean }>('DELETE', `/api/sessions/${encodeURIComponent(id)}`);
  output(result, json, () => `Closed ${id}.`);
}
