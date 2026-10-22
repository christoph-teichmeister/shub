// The Markdown of a notes draft: headings, paragraphs, lists (nested by indent, task items), quotes, fenced code,
// rules, and inline `code`, **bold**, *italic*, ~~strike~~ and [links](https://…). Parsed into blocks the view
// renders as elements, so nothing goes through {@html}. Unlike markdown.ts (release notes) "#58" is no PR link.

export interface Span {
  text: string;
  code?: boolean;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  /** Only http(s) and mailto links; anything else stays plain text. */
  href?: string;
}
export interface Item {
  text: Span[];
  depth: number;
  /** Task items: the box is ticked. */
  checked?: boolean;
}
export type Block =
  | { kind: 'heading'; level: number; text: Span[] }
  | { kind: 'p'; text: Span[] }
  | { kind: 'quote'; text: Span[] }
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'list'; ordered: boolean; items: Item[] }
  | { kind: 'rule' };

const INLINE =
  /`([^`]+)`|\*\*(.+?)\*\*|~~(.+?)~~|\*([^*\s](?:[^*]*[^*\s])?)\*|(?<![\w])_([^_\s](?:[^_]*[^_\s])?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function spans(line: string, flags: Omit<Span, 'text'> = {}): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    if (m.index > at) out.push({ text: line.slice(at, m.index), ...flags });
    at = m.index + m[0].length;
    if (m[1] !== undefined) out.push({ text: m[1], ...flags, code: true });
    else if (m[2] !== undefined) out.push(...spans(m[2], { ...flags, bold: true }));
    else if (m[3] !== undefined) out.push(...spans(m[3], { ...flags, strike: true }));
    else if (m[4] !== undefined || m[5] !== undefined) out.push(...spans(m[4] ?? m[5], { ...flags, italic: true }));
    else if (/^(https?:\/\/|mailto:)/i.test(m[7])) out.push(...spans(m[6], { ...flags, href: m[7] }));
    else out.push({ text: m[0], ...flags });
  }
  if (at < line.length) out.push({ text: line.slice(at), ...flags });
  return out;
}

export function parseDraft(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const last = blocks.at(-1);
    const fence = /^```\s*([\w+-]*)/.exec(line);
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (fence) {
      const body: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i]);
      blocks.push({ kind: 'code', text: body.join('\n'), lang: fence[1] });
    } else if (!line) blocks.push({ kind: 'p', text: [] });
    else if (heading) blocks.push({ kind: 'heading', level: heading[1].length, text: spans(heading[2]) });
    else if (/^([-*_])(\s*\1){2,}$/.test(line)) blocks.push({ kind: 'rule' });
    else if (line.startsWith('>')) {
      const text = spans(line.replace(/^>\s?/, ''));
      if (last?.kind === 'quote') last.text.push({ text: ' ' }, ...text);
      else blocks.push({ kind: 'quote', text });
    } else if (item) {
      const ordered = /\d/.test(item[2]);
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item[3]);
      const next: Item = {
        text: spans(task ? task[2] : item[3]),
        depth: Math.min(3, Math.floor(item[1].replace(/\t/g, '  ').length / 2)),
        ...(task && { checked: task[1] !== ' ' }),
      };
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(next);
      else blocks.push({ kind: 'list', ordered, items: [next] });
    } else if (last?.kind === 'p' && last.text.length) last.text.push({ text: ' ' }, ...spans(line));
    else if (last?.kind === 'p') last.text = spans(line);
    else blocks.push({ kind: 'p', text: spans(line) });
  }
  return blocks.filter((b) => b.kind !== 'p' || b.text.length);
}
