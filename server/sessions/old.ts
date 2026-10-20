// Earlier Claude conversations of a project, read from Claude Code's own transcripts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OldSession } from '../../shared/api.ts';

const MAX_FILES = 50;
const PROMPT_MAX = 300;

export const claudeDir = (): string => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');

/** Claude's folder name for a cwd: every non-alphanumeric char becomes "-" (checked against ~/.claude/projects). */
export const encodeCwd = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-');

/** Real prompts only: no meta entries, tool results or `<command-name>` style wrappers. */
function promptText(entry: { type?: string; isMeta?: boolean; message?: { content?: unknown } }): string | null {
  if (entry.type !== 'user' || entry.isMeta) return null;
  const content = entry.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter((c) => c?.type === 'text')
            .map((c) => c.text)
            .join('\n')
        : '';
  const trimmed = text.trim();
  return trimmed && !trimmed.startsWith('<') ? trimmed : null;
}

/**
 * The conversation's transcript and the folder Claude keeps it for. Usually `cwd`'s folder, but a session
 * that moved into a worktree (EnterWorktree) keeps writing under the worktree's folder; `claude --resume`
 * finds it only from there, so that folder is read back from the transcript's own `cwd` entries.
 */
export function findTranscript(
  claudeSessionId: string,
  cwd: string,
  root = claudeDir(),
): { file: string; cwd: string } | null {
  const projects = join(root, 'projects');
  const own = join(projects, encodeCwd(cwd), `${claudeSessionId}.jsonl`);
  if (existsSync(own)) return { file: own, cwd };
  let dirs: string[];
  try {
    dirs = readdirSync(projects);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const file = join(projects, dir, `${claudeSessionId}.jsonl`);
    if (!existsSync(file)) continue;
    // The entries' cwd follows every `cd`; the folder is the one whose name matches the directory.
    const match = readFileSync(file, 'utf8').match(/"cwd":"((?:[^"\\]|\\.)*)"/g) ?? [];
    for (const raw of new Set(match)) {
      const found = JSON.parse(raw.slice('"cwd":'.length)) as string;
      if (encodeCwd(found) === dir && statSync(found, { throwIfNoEntry: false })?.isDirectory()) {
        return { file, cwd: found };
      }
    }
  }
  return null;
}

export function summarizeTranscript(jsonl: string): { firstPrompt: string; turns: number } {
  let firstPrompt = '';
  let turns = 0;
  for (const line of jsonl.split('\n')) {
    if (!line) continue;
    let text: string | null;
    try {
      text = promptText(JSON.parse(line));
    } catch {
      continue; // a half-written last line
    }
    if (!text) continue;
    turns++;
    firstPrompt ||= text.slice(0, PROMPT_MAX);
  }
  return { firstPrompt, turns };
}

export function listOldSessions(projectId: string, cwd: string, skip: Set<string>, root = claudeDir()): OldSession[] {
  const dir = join(root, 'projects', encodeCwd(cwd));
  let files: { name: string; mtime: number }[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }));
  } catch {
    return [];
  }
  const out: OldSession[] = [];
  for (const file of files.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES)) {
    const claudeSessionId = file.name.slice(0, -'.jsonl'.length);
    if (skip.has(claudeSessionId)) continue;
    // ponytail: reads whole transcripts; stream the first lines if big projects get slow.
    const { firstPrompt, turns } = summarizeTranscript(readFileSync(join(dir, file.name), 'utf8'));
    if (turns === 0) continue;
    out.push({ claudeSessionId, projectId, firstPrompt, turns, lastAt: new Date(file.mtime).toISOString() });
  }
  return out;
}
