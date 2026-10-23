// A Markdown draft per session that the user edits in the notes panel and Claude edits as a plain file.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROUTES } from '../../shared/api.ts';
import { HttpError, requireUser } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services } from '../services.ts';
import { noteFile } from '../sessions/markdown.ts';

const MAX_BYTES = 1024 * 1024;

/** What the editor last saw of the text; a save carrying an older one lost against a change from outside. */
export const revision = (text: string): string => createHash('sha1').update(text).digest('hex');

/** Reads the file, creating it empty so Claude's Edit tool finds it. */
export function readNotes(file: string): { text: string; rev: string } {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '', { flag: 'a' });
  const text = readFileSync(file, 'utf8');
  return { text, rev: revision(text) };
}

/** Writes atomically unless the file changed since `rev` (then null: the caller reloads). */
export function saveNotes(file: string, text: string, rev: string): { rev: string } | null {
  if (readNotes(file).rev !== rev) return null;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  return { rev: revision(text) };
}

export function create(ctx: Context, services: Services): { module: ShubModule } {
  // A pane shares the draft of the session it belongs to; the id is a known session, never a path.
  const fileFor = (id: string): string => {
    const session = services.sessions.get(id);
    if (!session) throw new HttpError(404, 'no such session');
    return join(ctx.paths.stateDir, 'notes', `${session.parentId ?? session.id}.md`);
  };
  return {
    module: {
      name: 'notes',
      routes(router) {
        // A knowledge base note the terminal linked: the same editor, another file.
        const noteOf = (path: string | null): string => {
          const note = noteFile(path ?? '');
          if (!note) throw new HttpError(404, 'no note in the knowledge base');
          return note.file;
        };
        router.add(ROUTES.noteFile, (req) => {
          requireUser(req.caller);
          const file = noteOf(req.query.get('path'));
          return readNotes(file);
        });
        router.add(ROUTES.noteFileSave, async (req) => {
          requireUser(req.caller);
          const file = noteOf(req.query.get('path'));
          const { text, rev } = await req.json<{ text?: unknown; rev?: unknown }>();
          if (typeof text !== 'string' || typeof rev !== 'string') throw new HttpError(400, 'text, rev: string');
          if (Buffer.byteLength(text) > MAX_BYTES) throw new HttpError(413, 'note too large');
          const saved = saveNotes(file, text, rev);
          if (!saved) throw new HttpError(409, 'the note changed meanwhile');
          return saved;
        });
        router.add(ROUTES.notes, (req) => {
          requireUser(req.caller);
          const file = fileFor(req.params.id);
          return { path: file, ...readNotes(file) };
        });
        router.add(ROUTES.notesSave, async (req) => {
          requireUser(req.caller);
          const file = fileFor(req.params.id);
          const { text, rev } = await req.json<{ text?: unknown; rev?: unknown }>();
          if (typeof text !== 'string' || typeof rev !== 'string') throw new HttpError(400, 'text, rev: string');
          if (Buffer.byteLength(text) > MAX_BYTES) throw new HttpError(413, 'notes too large');
          const saved = saveNotes(file, text, rev);
          if (!saved) throw new HttpError(409, 'the notes changed meanwhile');
          return saved;
        });
      },
    },
  };
}
