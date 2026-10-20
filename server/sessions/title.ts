// Short session titles from a prompt, written by a small model through the user's own `claude`.
import { execFile } from 'node:child_process';

/** A short title for the prompt, or null when none could be made. Tests swap this out. */
export type Titler = (prompt: string) => Promise<string | null>;

const ASK =
  'Give a 2 to 4 word title for a coding session that starts with the request below. ' +
  'Use the language of the request, no quotes, no trailing period. Reply with the title only.\n\nRequest:\n';

/** First line of the model's answer, without quotes, markdown or a trailing period; null when unusable. */
export function cleanTitle(raw: string): string | null {
  const line = raw.trim().split('\n')[0] ?? '';
  const title = line
    .replace(/^(title|titel)\s*:\s*/i, '')
    .replace(/^[\s"'`*#„“”]+|[\s"'`*„“”.]+$/g, '')
    .trim();
  return title && title.length <= 60 ? title : null;
}

// --setting-sources '' keeps the user's hooks and CLAUDE.md out, --no-session-persistence keeps the
// call out of ~/.claude/projects (shub lists old sessions from there).
export const defaultTitler: Titler = (prompt) =>
  new Promise((resolve) => {
    const args = ['-p', '--model', 'haiku', '--no-session-persistence', '--setting-sources', '', '--tools', ''];
    const child = execFile('claude', args, { timeout: 30_000 }, (err, stdout) =>
      resolve(err ? null : cleanTitle(stdout)),
    );
    child.stdin?.end(ASK + prompt.slice(0, 2000));
  });
