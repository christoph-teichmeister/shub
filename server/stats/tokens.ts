// Token usage per model from the new lines of a Claude transcript (assistant lines carry message.usage).
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type { TokenSums } from '../../shared/api.ts';

export interface TokenRow {
  ts: number;
  model: string;
  tokens: TokenSums;
}

/** Sums the complete lines of `text` per model and hour-free timestamp; a message id seen twice counts once. */
export function sumUsage(text: string, seen = new Set<string>()): TokenRow[] {
  const out: TokenRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let e: Record<string, any>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const u = e.message?.usage;
    if (e.type !== 'assistant' || !u) continue;
    const id = e.message.id ?? e.uuid;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const ts = Date.parse(e.timestamp);
    if (Number.isNaN(ts)) continue;
    out.push({
      ts,
      model: String(e.message.model ?? 'unknown'),
      tokens: {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheCreate: u.cache_creation_input_tokens ?? 0,
      },
    });
  }
  return out;
}

/** The text from byte `from` to the last newline, and the offset after it. */
export function readFrom(file: string, from: number): { text: string; offset: number } {
  const size = statSync(file).size;
  if (size <= from) return { text: '', offset: size < from ? 0 : from };
  const buf = Buffer.alloc(size - from);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, buf.length, from);
  } finally {
    closeSync(fd);
  }
  const end = buf.lastIndexOf(10) + 1;
  return { text: buf.subarray(0, end).toString('utf8'), offset: from + end };
}
