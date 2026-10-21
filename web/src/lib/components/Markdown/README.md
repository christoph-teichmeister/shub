# Markdown

Renders release-notes Markdown (headings, `- ` lists, paragraphs, `` `code` ``, PR numbers like #58 as links) as elements, never through `{@html}`. Parsing lives in `lib/markdown.ts`.

| Prop | Type     | Default |
| ---- | -------- | ------- |
| `md` | `string` |         |

Used by the changelog in Settings > Updates and the "Updated to shub x" toast.
