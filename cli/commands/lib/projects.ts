import type { ProjectView } from '../../../shared/api.ts';
import { api, CliError } from './client.ts';

/** Finds a project by id or (case-insensitive) name. */
export async function findProject(ref: string | undefined): Promise<ProjectView> {
  if (!ref) throw new CliError('which project? Pass an id or name (see "shub project list").');
  const projects = await api<ProjectView[]>('GET', '/api/projects');
  const found = projects.find((p) => p.id === ref) ?? projects.find((p) => p.name.toLowerCase() === ref.toLowerCase());
  if (!found) throw new CliError(`no project "${ref}"`);
  return found;
}
