// Session names from a GitLab MR or GitHub PR link in a prompt, looked up through the user's own `glab` / `gh`.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface MrRef {
  url: string;
  host: string;
  /** GitLab project path or GitHub owner/repo. */
  repo: string;
  number: number;
  github: boolean;
  /** Chip label and name prefix for a title without a ticket: `MR !12` / `PR #12`. */
  label: string;
}

/** The MR/PR's title and whether the user wrote it, or null when it could not be looked up. Tests swap this out. */
export type MrLookup = (ref: MrRef) => Promise<{ title: string; mine: boolean } | null>;

const GITHUB = /https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;
const GITLAB = /https?:\/\/([^/\s]+)\/(\S+?)\/-\/merge_requests\/(\d+)/;

/** The first MR/PR link in the prompt, or null. */
export function findMr(prompt: string): MrRef | null {
  const gh = GITHUB.exec(prompt);
  if (gh) {
    const number = Number(gh[2]);
    return { url: gh[0], host: 'github.com', repo: gh[1]!, number, github: true, label: `PR #${number}` };
  }
  const gl = GITLAB.exec(prompt);
  if (!gl) return null;
  const number = Number(gl[3]);
  return { url: gl[0], host: gl[1]!, repo: gl[2]!, number, github: false, label: `MR !${number}` };
}

/** Same shape as the worktree skills: 🔨 own MR, 👀 someone else's; a title without `#<ticket>` gets the label in front,
 *  so session-emoji.timer keeps flipping 🔨/💬 on it. */
export const mrName = (ref: MrRef, mr: { title: string; mine: boolean }): string =>
  `${mr.mine ? '🔨' : '👀'} ${/#\d+/.test(mr.title) ? mr.title : `${ref.label}: ${mr.title}`}`;

const json = async (cmd: string, args: string[]): Promise<Record<string, unknown>> =>
  JSON.parse((await run(cmd, args, { timeout: 15_000 })).stdout);

export const defaultMrLookup: MrLookup = async (ref) => {
  try {
    if (ref.github) {
      const [pr, me] = await Promise.all([
        json('gh', ['pr', 'view', ref.url, '--json', 'title,author']),
        json('gh', ['api', 'user']),
      ]);
      return { title: String(pr.title), mine: (pr.author as { login: string }).login === me.login };
    }
    const host = ['--hostname', ref.host];
    const [mr, me] = await Promise.all([
      json('glab', ['api', ...host, `projects/${encodeURIComponent(ref.repo)}/merge_requests/${ref.number}`]),
      json('glab', ['api', ...host, 'user']),
    ]);
    return { title: String(mr.title), mine: (mr.author as { username: string }).username === me.username };
  } catch {
    return null;
  }
};
