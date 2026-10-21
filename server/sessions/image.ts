// Images a session points at in its output (screenshots, pastes), for the terminal's image viewer.
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, sep } from 'node:path';

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * The real file and its type when `path` is an image shub may show, else null.
 * Only images under Claude's temp folders (`/tmp/claude-*`: screenshots, scratchpads) and shub's own pastes,
 * resolved through symlinks, so a link cannot point the viewer at any other file.
 */
export function viewableImage(path: string, stateDir: string): { file: string; type: string } | null {
  const type = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!type || !path.startsWith(sep)) return null;
  let file: string;
  try {
    file = realpathSync(path);
  } catch {
    return null;
  }
  if (IMAGE_TYPES[extname(file).toLowerCase()] !== type) return null;
  const tmp = realpathSync(tmpdir()) + sep;
  const pastes = join(stateDir, 'pastes') + sep;
  const inTmp = file.startsWith(tmp) && file.slice(tmp.length).startsWith('claude-');
  return inTmp || file.startsWith(pastes) ? { file, type } : null;
}
