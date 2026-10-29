// What may be typed or pasted into a session: named keys, text, and files saved under <stateDir>/pastes.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { HttpError } from '../api/router.ts';

export const NAMED_KEYS = new Set(['Escape', 'C-c', 'Up', 'Down', 'PageUp', 'PageDown', 'Tab', 'Enter']);
const LITERAL_MAX = 2000;
const TEXT_PASTE_MAX = 1024 * 1024;
export const FILE_PASTE_MAX = 500 * 1024 * 1024;
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

/** Saves any file under <stateDir>/pastes and returns its absolute path (Claude picks up image paths). */
export function savePaste(stateDir: string, contentType: string, body: Buffer, name: string): string {
  const nameExt = extname(name).slice(1).toLowerCase();
  const ext =
    PASTE_TYPES[contentType.split(';')[0].trim().toLowerCase()] ?? (/^[a-z0-9]{1,10}$/.test(nameExt) ? nameExt : 'bin');
  if (body.length === 0 || body.length > FILE_PASTE_MAX) throw new HttpError(413, 'file must be 1 byte to 500 MB');
  const dir = join(stateDir, 'pastes');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${randomUUID()}.${ext}`);
  writeFileSync(file, body, { mode: 0o600 });
  return file;
}
