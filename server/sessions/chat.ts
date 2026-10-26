// The phone's chat view: the tail of a Claude transcript as a short typed message list.
//
// Transcript facts (Claude Code, checked on real transcripts): one line per content block. `user` lines carry the
// prompt (a string, or text blocks) or `tool_result` blocks; `assistant` lines carry one `text`, `thinking` or
// `tool_use` block. Subagent lines have `isSidechain`, injected context `isMeta`; prompts that start with "<" are
// command wrappers (`<command-name>`, `<local-command-stdout>`); a prompt like "<div> breaks" is real.
import type { ChatMessage } from '../../shared/api.ts';
import { read } from './context.ts';

const TAIL = 512 * 1024;
const LIMIT = 80;
const SUMMARY_MAX = 120;
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

/** Messages of the transcript lines in `jsonl` (oldest first, at most `limit`); a tool call shows its result's status. */
export function parseChat(jsonl: string, limit = LIMIT): ChatMessage[] {
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
        if (tool) tool.status = b.is_error ? 'error' : 'ok';
      }
    });
  }
  return out.slice(-limit);
}

/** The last messages of a transcript file; only its tail is read. */
export const chatMessages = (file: string): ChatMessage[] => parseChat(read(file, TAIL));
