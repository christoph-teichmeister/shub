// Image paths in a terminal's buffer (screenshots, pastes), also when they wrap over several rows.

/** An absolute image path; paths with spaces are not matched. */
const IMAGE_PATH = /(?<![\w.~/-])\/[^\s'"`()<>[\]]+?\.(?:png|jpe?g|gif|webp)(?!\w)/gi;
/** A path to a Markdown note with a slash in it; only the file name may hold spaces ("Decisions/2026-10-23 Some Note.md"). */
export const NOTE_PATH = /(?<![\w.~/-])(?:~?\/)?(?:[\w.-]+\/)+[\w.-]+(?: [\w.-]+)*?\.md(?!\w)/g;
/** Rows joined at most into one line, so a full-width table does not become one long line. */
const MAX_ROWS = 8;

// The parts of xterm's IBuffer this reads.
interface Cell {
  getChars(): string;
  getWidth(): number;
}
interface Line {
  isWrapped: boolean;
  length: number;
  getCell(x: number): Cell | undefined;
}
export interface Buffer {
  length: number;
  getLine(y: number): Line | undefined;
}

/** 1-based cell position, as xterm links take it. */
interface Pos {
  x: number;
  y: number;
}
export interface ImagePath {
  path: string;
  start: Pos;
  end: Pos;
}

/** A row's text and the cell of every UTF-16 unit, read cell by cell so wide characters keep their columns. */
function row(buf: Buffer, y: number): { text: string; pos: Pos[] } {
  const line = buf.getLine(y);
  let text = '';
  const pos: Pos[] = [];
  for (let x = 0; line && x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell || cell.getWidth() === 0) continue; // second half of a wide character
    const chars = cell.getChars() || ' ';
    text += chars;
    for (let i = 0; i < chars.length; i++) pos.push({ x: x + 1, y: y + 1 });
  }
  return { text, pos };
}

/**
 * Whether row y continues row y - 1: xterm wrapped it, or a program wrapped it with a line break
 * (Claude's renderer: the row above fills the last column, this one goes on after its indent).
 */
function continues(buf: Buffer, y: number): 'soft' | 'hard' | null {
  const line = buf.getLine(y);
  if (!line || y === 0) return null;
  if (line.isWrapped) return 'soft';
  const above = row(buf, y - 1).text;
  return above.length && !/\s$/.test(above) && /^\s*\S/.test(row(buf, y).text) ? 'hard' : null;
}

/** Joins rows first..last into one text; a hard-wrapped row drops its indent. */
function joined(buf: Buffer, first: number, last: number): { text: string; pos: Pos[] } {
  let text = '';
  const pos: Pos[] = [];
  for (let y = first; y <= last; y++) {
    const r = row(buf, y);
    const skip = y > first && continues(buf, y) === 'hard' ? r.text.length - r.text.trimStart().length : 0;
    text += r.text.slice(skip);
    pos.push(...r.pos.slice(skip));
  }
  return { text, pos };
}

function lineEnd(buf: Buffer, first: number): number {
  let last = first;
  while (last - first < MAX_ROWS - 1 && last + 1 < buf.length && continues(buf, last + 1)) last++;
  return last;
}

function matches(buf: Buffer, first: number, last: number, re: RegExp): ImagePath[] {
  const { text, pos } = joined(buf, first, last);
  return [...text.matchAll(re)].map((m) => ({
    path: m[0],
    start: pos[m.index],
    end: pos[m.index + m[0].length - 1],
  }));
}

/** Image paths that touch row y (0-based), with the rows they wrap over. */
export function imagePathsAt(buf: Buffer, y: number, re = IMAGE_PATH): ImagePath[] {
  let first = y;
  while (y - first < MAX_ROWS - 1 && continues(buf, first)) first--;
  return matches(buf, first, lineEnd(buf, first), re).filter((p) => p.start.y <= y + 1 && p.end.y >= y + 1);
}

/** Every image path in the buffer, oldest first, each once. */
export function allImagePaths(buf: Buffer): string[] {
  const paths = new Set<string>();
  for (let y = 0; y < buf.length; y++) {
    const last = lineEnd(buf, y);
    for (const p of matches(buf, y, last, IMAGE_PATH)) paths.add(p.path);
    y = last;
  }
  return [...paths];
}
