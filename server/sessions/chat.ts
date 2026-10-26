// The phone's chat view: the tail of a Claude transcript as a short typed message list.
//
// Transcript facts (Claude Code, checked on real transcripts): one line per content block. `user` lines carry the
// prompt (a string, or text blocks) or `tool_result` blocks; `assistant` lines carry one `text`, `thinking` or
// `tool_use` block. Subagent lines have `isSidechain`, injected context `isMeta`; prompts that start with "<" are
// command wrappers (`<command-name>`, `<local-command-stdout>`); a prompt like "<div> breaks" is real.
import { closeSync, openSync, readSync, statSync, watch, type FSWatcher } from 'node:fs';
import type { ChatDelta, ChatMessage } from '../../shared/api.ts';

const TAIL = 512 * 1024;
const LIMIT = 80;
const SUMMARY_MAX = 120;
const RESULT_MAX = 2000;
/** Wrapper tags Claude Code puts around commands and injected context; any other prompt starting with "<" is real. */
const WRAPPER =
  /^<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|system-reminder)\b/;
/** The tool input that says best what a call does, first one present wins. */
const SUMMARY_FIELDS = ['file_path', 'command', 'pattern', 'path', 'url', 'query', 'skill', 'description'];

function summary(input: Record<string, unknown> | undefined): string {
  for (const field of SUMMARY_FIELDS) {
    const value = input?.[field];
    if (typeof value === 'string' && value.trim()) return value.trim().split('\n')[0].slice(0, SUMMARY_MAX);
  }
  return '';
}

/** A tool result's text: a string, or the text blocks of an array. */
function resultText(content: unknown): string {
  const text = Array.isArray(content)
    ? content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n')
    : content;
  return typeof text === 'string' ? text.trim().slice(0, RESULT_MAX) : '';
}

/**
 * Messages of the transcript lines in `jsonl` (oldest first, at most `limit`); a tool call shows its result's status
 * and text. With `patches`, a result whose call is not in `jsonl` (an earlier chunk) comes out as a nameless tool
 * message for the client to merge into the call it already has.
 */
export function parseChat(jsonl: string, limit = LIMIT, patches = false): ChatMessage[] {
  const out: ChatMessage[] = [];
  const tools = new Map<string, Extract<ChatMessage, { role: 'tool' }>>();
  for (const line of jsonl.split('\n')) {
    let entry: Record<string, any>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // blank, or a half-written last line
    }
    if (entry.isSidechain || entry.isMeta || (entry.type !== 'user' && entry.type !== 'assistant')) continue;
    const content = entry.message?.content;
    const blocks: Record<string, any>[] =
      typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    blocks.forEach((b, i) => {
      const id = `${entry.uuid}:${i}`;
      if (b.type === 'text' && typeof b.text === 'string') {
        const text = b.text.trim();
        if (text && !(entry.type === 'user' && WRAPPER.test(text))) out.push({ id, role: entry.type, text });
      } else if (b.type === 'tool_use' && entry.type === 'assistant' && !tools.has(b.id ?? id)) {
        const tool = {
          id: b.id ?? id,
          role: 'tool',
          name: String(b.name),
          summary: summary(b.input),
          status: 'running',
        } as const;
        tools.set(tool.id, tool);
        out.push(tool);
      } else if (b.type === 'tool_result') {
        const tool = tools.get(b.tool_use_id);
        const status = b.is_error ? 'error' : 'ok';
        const result = resultText(b.content);
        if (tool) Object.assign(tool, { status, result });
        else if (patches) out.push({ id: b.tool_use_id, role: 'tool', name: '', summary: '', status, result });
      }
    });
  }
  return out.slice(-limit);
}

/**
 * The chat of a transcript file by byte offset. Without `after` (or when it is past the end, or more than the tail
 * behind) it is the last messages (`reset`); otherwise only those of the lines complete since `after`. `offset` is
 * where the next call continues: after the last complete line.
 */
export function chatSince(file: string, after?: number): ChatDelta {
  const size = statSync(file).size;
  const full = after === undefined || after > size || size - after > TAIL;
  const start = full ? Math.max(0, size - TAIL) : after;
  const buf = Buffer.alloc(size - start);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  // A tail starts mid-line: skip to the first newline. An unfinished last line waits for the next call.
  const from = full && start > 0 ? buf.indexOf(10) + 1 : 0;
  const to = buf.lastIndexOf(10) + 1;
  const text = to > from ? buf.toString('utf8', from, to) : '';
  return { messages: parseChat(text, full ? LIMIT : Infinity, !full), offset: start + Math.max(from, to), reset: full };
}

const following = new Map<string, { idle: NodeJS.Timeout; stop: () => void }>();

/**
 * Calls `onChange` (at most once per `throttleMs`) while `file` grows, so the chat sees each block as Claude writes it,
 * not only after the next hook. Every call keeps the watch alive; it closes after `idleMs` without one (the phone
 * refetches on each change, so an open chat keeps it going and a closed one lets it lapse).
 * ponytail: Claude writes a transcript line per finished block, not per token; true token streaming is not in the data.
 */
export function followTranscript(file: string, onChange: () => void, throttleMs = 250, idleMs = 5 * 60_000): void {
  const known = following.get(file);
  if (known) {
    known.idle.refresh();
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher;
  try {
    watcher = watch(file, () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        onChange();
      }, throttleMs);
    });
  } catch {
    return; // file gone: the next fetch tries again
  }
  const entry = {
    idle: setTimeout(() => entry.stop(), idleMs).unref(),
    stop: () => {
      clearTimeout(entry.idle);
      clearTimeout(timer);
      watcher.close();
      following.delete(file);
    },
  };
  watcher.on('error', entry.stop);
  following.set(file, entry);
}
