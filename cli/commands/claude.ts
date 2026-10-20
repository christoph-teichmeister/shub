import type { Approval, Session } from '../../shared/api.ts';
import { api, CliError, output } from './lib/client.ts';

export const summary = 'Start a Claude session in the folder of this shub terminal (opens as a new tab).';
export const usage = 'shub claude   (inside a shub terminal; the folder must lie inside one of the project worktrees)';

export async function run(_args: string[], opts: { json: boolean }): Promise<void> {
  const id = process.env.SHUB_SESSION_ID;
  if (!id) throw new CliError('run this inside a shub terminal');
  const result = await api<Session | { approval: Approval }>('POST', `/api/sessions/${id}/claude-here`);
  output(result, opts.json, () =>
    'approval' in result
      ? `Waiting for approval in shub: ${result.approval.summary} (${result.approval.id}).`
      : `Started ${result.name} (${result.id}) in ${result.cwd}.`,
  );
}
