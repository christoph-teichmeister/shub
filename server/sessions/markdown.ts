// Markdown notes a session names in its output, opened in the knowledge base app instead of a terminal editor.
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/**
 * The note URL for `path` (relative to the knowledge base, or absolute inside it), else null.
 * `KB_NOTE_URL` holds the template with `{path}`; without it, `KB_CARD_URL` (`…/cards/{id}`) names the same app.
 * ponytail: a note must exist on this machine; a note only the HA copy has gets no link.
 */
export function noteUrl(path: string, env: NodeJS.ProcessEnv = process.env, home = homedir()): string | null {
  const template = env.KB_NOTE_URL || env.KB_CARD_URL?.replace(/cards\/\{id\}$/, 'notes/{path}');
  if (!template?.includes('{path}') || !path.endsWith('.md')) return null;
  let root: string;
  let file: string;
  try {
    root = realpathSync(env.KB_DIR || join(home, 'knowledge-base'));
    const full = resolve(root, path.replace(/^~\//, home + '/'));
    if (!existsSync(full)) return null;
    file = realpathSync(full);
  } catch {
    return null;
  }
  if (!file.startsWith(root + sep)) return null;
  const name = file.slice(root.length + 1, -'.md'.length);
  return template.replace('{path}', name.split(sep).map(encodeURIComponent).join('/'));
}
