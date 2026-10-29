// Markdown notes a session names in its output, opened in the knowledge base app instead of a terminal editor.
import { existsSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

/** The knowledge base folder, home-relative default. */
const kbRoot = (env: NodeJS.ProcessEnv, home: string): string => env.KB_DIR || join(home, 'knowledge-base');

/** Claude's per-user scratch tree (`/tmp/claude-<uid>/…/scratchpad/`): drafts it names open in the panel too. */
const scratchRoot = (tmp: string): string => join(tmp, `claude-${process.getuid?.() ?? ''}`);

/**
 * The real file and its note name (no `.md`) when `path` is an existing note inside the knowledge base,
 * given relative to it, as `~/...` or absolute; else null. A file in Claude's scratch tree counts as a note
 * with an empty name (no KB app URL).
 */
export function noteFile(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  tmp = tmpdir(),
): { file: string; name: string } | null {
  if (!path.endsWith('.md')) return null;
  if (isAbsolute(path)) {
    try {
      const file = realpathSync(path);
      if (file.startsWith(realpathSync(scratchRoot(tmp)) + sep)) return { file, name: '' };
    } catch {
      // no such file or no scratch tree: maybe a KB note
    }
  }
  try {
    const root = realpathSync(kbRoot(env, home));
    const full = resolve(root, path.replace(/^~\//, home + '/'));
    if (!existsSync(full)) return null;
    const file = realpathSync(full);
    return file.startsWith(root + sep) ? { file, name: file.slice(root.length + 1, -'.md'.length) } : null;
  } catch {
    return null;
  }
}

/**
 * The KB app's URL for a note. `KB_NOTE_URL` holds the template with `{path}`; without it, `KB_CARD_URL`
 * (`…/cards/{id}`) names the same app.
 * ponytail: a note must exist on this machine; a note only the HA copy has gets no link.
 */
export function noteUrl(path: string, env: NodeJS.ProcessEnv = process.env, home = homedir()): string | null {
  const template = env.KB_NOTE_URL || env.KB_CARD_URL?.replace(/cards\/\{id\}$/, 'notes/{path}');
  const note = template?.includes('{path}') ? noteFile(path, env, home) : null;
  return note?.name ? template!.replace('{path}', note.name.split(sep).map(encodeURIComponent).join('/')) : null;
}
