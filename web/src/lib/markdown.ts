// The Markdown of release notes (scripts/release/release.ts writes it): headings, "- " lists, paragraphs, `code`
// and PR numbers like (#58). Parsed into blocks the view renders as elements, so nothing goes through {@html}.

export type Inline = { text: string; code?: boolean; pr?: number };
export type Block =
  | { kind: 'heading'; level: number; text: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'p'; text: Inline[] };

/** Splits `code` spans and #123 PR references out of a line. */
export function inline(line: string): Inline[] {
  return line
    .split(/(`[^`]+`|#\d+\b)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('`')
        ? { text: part.slice(1, -1), code: true }
        : /^#\d+$/.test(part)
          ? { text: part, pr: Number(part.slice(1)) }
          : { text: part },
    );
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^[-*]\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (!line) blocks.push({ kind: 'p', text: [] });
    else if (heading) blocks.push({ kind: 'heading', level: heading[1].length, text: inline(heading[2]) });
    else if (item && last?.kind === 'list') last.items.push(inline(item[1]));
    else if (item) blocks.push({ kind: 'list', items: [inline(item[1])] });
    else if (last?.kind === 'p' && last.text.length) last.text.push({ text: ' ' }, ...inline(line));
    else if (last?.kind === 'p') last.text = inline(line);
    else blocks.push({ kind: 'p', text: inline(line) });
  }
  return blocks.filter((b) => b.kind !== 'p' || b.text.length);
}
