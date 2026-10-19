// Earlier Claude conversations of a project, read from Claude Code's own transcripts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
