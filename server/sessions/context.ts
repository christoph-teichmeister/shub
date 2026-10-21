// How full a session's context is, read from Claude Code's own transcript.
//
// Transcript facts (Claude Code 2.1.306, checked on real transcripts):
//   assistant lines: message.usage { input_tokens, cache_read_input_tokens, cache_creation_input_tokens }; their sum
//                    is what the model saw. message.model has no "[1m]", so it cannot tell the window.
//   attachment lines: { type: 'model', identity: { modelId: 'claude-opus-5-5[1m]' } } at the start and after every
//                    compact; the "[1m]" marks the 1M window.
//   system lines:    { subtype: 'compact_boundary', compactMetadata: { postTokens } } after a /compact.
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type { ContextFill } from '../../shared/api.ts';

const TAIL = 256 * 1024;
const WINDOW = 200_000;
const WINDOW_1M = 1_000_000;

const windowOf = (modelId: string): number => (modelId.includes('[1m]') ? WINDOW_1M : WINDOW);

function read(file: string, from: number): string {
  const size = statSync(file).size;
  const start = Math.max(0, size - from);
  const buf = Buffer.alloc(size - start);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  const text = buf.toString('utf8');
  // A tail starts mid-line: drop that partial line.
  return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
}

/** Reads lines from the end: the newest usage (or compact) and the newest model attachment. */
function scan(text: string): { tokens: number | null; window: number | null } {
  let tokens: number | null = null;
  let window: number | null = null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0 && (tokens === null || window === null); i--) {
    const line = lines[i];
    // Cheap filter before parsing: most lines are tool output.
    if (!line.includes('"usage"') && !line.includes('"compact_boundary"') && !line.includes('"modelId"')) continue;
    let entry: Record<string, any>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (tokens === null && entry.type === 'assistant' && entry.message?.usage && !entry.isSidechain) {
      const u = entry.message.usage;
      tokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    } else if (tokens === null && entry.subtype === 'compact_boundary') {
      tokens = entry.compactMetadata?.postTokens ?? 0;
    } else if (window === null && entry.type === 'attachment' && entry.attachment?.type === 'model') {
      const id = entry.attachment.identity?.modelId;
      if (typeof id === 'string') window = windowOf(id);
    }
  }
  return { tokens, window };
}

/**
 * The context fill of a transcript, or null while it has no reply yet. Reads only the tail; the whole file only
 * when the tail holds no model attachment and `knownWindow` is unset (once per session).
 */
export function contextFill(file: string, knownWindow?: number): ContextFill | null {
  let { tokens, window } = scan(read(file, TAIL));
  if (tokens === null) return null;
  if (window === null) window = knownWindow ?? scan(read(file, Infinity)).window ?? WINDOW;
  // A context past 200k can only be a 1M window.
  if (tokens > WINDOW) window = Math.max(window, WINDOW_1M);
  return { tokens, window };
}
