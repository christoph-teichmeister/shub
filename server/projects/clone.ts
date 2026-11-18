// New project from a git source: where it may go (the root's subfolders), which repos gh / glab can see, the clone.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { CloneOptions, CloneRequest } from '../../shared/api.ts';
import { HttpError } from '../api/router.ts';
import { expandHome } from '../config/index.ts';

const run = promisify(execFile);
const CLONE_TIMEOUT_MS = 10 * 60_000;
const NAME = /^[\w][\w.-]*$/;
/** https, ssh or scp-style; never a leading "-" (git would read it as an option). */
const URL_OK = /^(https:\/\/|ssh:\/\/|git@)[^\s]+$/;

function bad(message: string): never {
  throw new HttpError(400, message);
}

/** The configured root, else ~/PycharmProjects when it exists, else ''. */
export function rootOf(setting: string | undefined, home = homedir()): string {
  const root = setting?.trim() ? expandHome(setting.trim(), home) : join(home, 'PycharmProjects');
  return statSync(root, { throwIfNoEntry: false })?.isDirectory() ? root : '';
}

function subfolders(root: string): string[] {
  if (!root) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.') && statSync(join(root, d.name), { throwIfNoEntry: false })?.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Repos the CLI's login can see; empty when the CLI is missing or not logged in (a pasted URL still works). */
async function repos(source: string | null): Promise<CloneOptions['repos']> {
  try {
    if (source === 'github') {
      const { stdout } = await run('gh', ['repo', 'list', '--limit', '200', '--json', 'nameWithOwner,url'], {
        timeout: 30_000,
      });
      return (JSON.parse(stdout) as { nameWithOwner: string; url: string }[]).map((r) => ({
        name: r.nameWithOwner,
        url: r.url,
      }));
    }
    if (source === 'gitlab') {
      const { stdout } = await run('glab', ['repo', 'list', '-F', 'json', '-P', '100'], { timeout: 30_000 });
      return (JSON.parse(stdout) as { path_with_namespace: string; ssh_url_to_repo: string }[]).map((r) => ({
        name: r.path_with_namespace,
        url: r.ssh_url_to_repo,
      }));
    }
  } catch {
    /* not installed / not logged in */
  }
  return [];
}

export async function cloneOptions(setting: string | undefined, source: string | null): Promise<CloneOptions> {
  const root = rootOf(setting);
  return { root, folders: subfolders(root), repos: await repos(source) };
}

/** `git clone` of the default branch into <root>/<folder>/<name>; returns that path. */
export async function cloneRepo(setting: string | undefined, req: CloneRequest): Promise<string> {
  const root = rootOf(setting);
  if (!root) bad('set a projects folder in Settings first');
  const url = typeof req.url === 'string' ? req.url.trim() : '';
  if (!URL_OK.test(url)) bad('url must be an https://, ssh:// or git@ address');
  if (!subfolders(root).includes(req.folder)) bad('folder is not a subfolder of the projects folder');
  const name =
    (req.name?.trim() ||
      url
        .replace(/\/+$/, '')
        .replace(/\.git$/, '')
        .split(/[/:]/)
        .pop()) ??
    '';
  if (!NAME.test(name)) bad('name may only hold letters, digits, ".", "_" and "-"');
  const path = join(root, req.folder, name);
  if (existsSync(path)) throw new HttpError(409, 'that folder already exists');
  try {
    await run('git', ['clone', '--', url, path], { timeout: CLONE_TIMEOUT_MS });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim().split('\n').pop();
    throw new HttpError(502, `git clone failed: ${stderr || (err as Error).message}`);
  }
  return path;
}
