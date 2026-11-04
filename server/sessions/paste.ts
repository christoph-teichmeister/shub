// What may be typed or pasted into a session: named keys, text, and files saved under <stateDir>/pastes.
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../api/router.ts';

export const NAMED_KEYS = new Set(['Escape', 'C-c', 'Up', 'Down', 'PageUp', 'PageDown', 'Tab', 'Enter']);
const LITERAL_MAX = 2000;
const TEXT_PASTE_MAX = 1024 * 1024;
export const FILE_PASTE_MAX = 500 * 1024 * 1024;
/** Pasted files older than this are deleted when shub starts; the session read them long before. */
const PASTE_KEEP_MS = 7 * 24 * 3600_000;

/** Deletes pasted files older than PASTE_KEEP_MS; nothing else ever cleans <stateDir>/pastes. */
export function prunePastes(stateDir: string, now = Date.now()): void {
  const dir = join(stateDir, 'pastes');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return; // nothing pasted yet
  }
  for (const name of names) {
    const file = join(dir, name);
    const stat = statSync(file, { throwIfNoEntry: false });
    if (stat?.isFile() && stat.mtimeMs < now - PASTE_KEEP_MS) rmSync(file, { force: true });
  }
}
const PASTE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/** Each key is a named key or text up to LITERAL_MAX chars. */
export function checkKeys(keys: string[]): void {
  for (const key of keys) {
    if (typeof key !== 'string' || key.length === 0 || key.length > LITERAL_MAX) {
      throw new HttpError(400, `keys must be named keys or text up to ${LITERAL_MAX} chars`);
    }
  }
}

export function checkText(text: string): void {
  if (!text || text.length > TEXT_PASTE_MAX) throw new HttpError(400, 'text must be 1 byte to 1 MB');
}

/** Streams any file to <stateDir>/pastes and returns its absolute path (Claude picks up image paths). */
export async function savePaste(stateDir: string, contentType: string, body: Readable, name: string): Promise<string> {
  const nameExt = extname(name).slice(1).toLowerCase();
  const ext =
    PASTE_TYPES[contentType.split(';')[0].trim().toLowerCase()] ?? (/^[a-z0-9]{1,10}$/.test(nameExt) ? nameExt : 'bin');
  const tooLarge = new HttpError(413, 'file must be 1 byte to 500 MB');
  const dir = join(stateDir, 'pastes');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${randomUUID()}.${ext}`);
  let size = 0;
  try {
    await pipeline(
      body,
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          if ((size += chunk.length) > FILE_PASTE_MAX) throw tooLarge;
          yield chunk;
        }
      },
      createWriteStream(file, { mode: 0o600 }),
    );
    if (size === 0) throw tooLarge;
  } catch (err) {
    rmSync(file, { force: true });
    throw err;
  }
  return file;
}
