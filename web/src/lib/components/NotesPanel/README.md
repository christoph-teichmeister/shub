# NotesPanel

A Markdown draft beside the terminal that you and Claude write together. One file per session (`<dataDir>/notes/<session id>.md`, a pane shares its session's), written in a plain textarea; the Preview button shows it rendered (`lib/draft.ts` parses headings, lists, task items, quotes, code, bold, italic, strike, http(s) links into elements, never `{@html}`), still updating as Claude edits. Typing saves after a short pause; every 2 s the panel looks for changes Claude made to the file and shows them. If the file changed while you have unsaved typing, a bar offers "Take theirs" or "Keep mine". "Tell Claude" pastes the file path and how to work on it into Claude's prompt.

| Prop        | Type                    |
| ----------- | ----------------------- |
| `sessionId` | `string`                |
| `claudeId`  | `string`                |
| `onhide`    | `() => void`            |
| `note`      | `{ file, url } \| null` |
| `onback`    | `() => void`            |

States: write, preview, saved, saving, changed outside (conflict bar).

A Markdown path of the knowledge base that a terminal prints is a link; a click sets `stores/noteFile` and the panel (keyed by that file) shows and edits that note instead of the draft, with the same save and conflict handling (`GET/PUT /api/note-file`). "KB app" opens it in the KB app, the back arrow returns to the draft. Only existing notes inside `KB_DIR` open.
