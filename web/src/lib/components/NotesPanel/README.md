# NotesPanel

A Markdown draft beside the terminal that you and Claude write together. One file per session (`<stateDir>/notes/<session id>.md`, a pane shares its session's), shown in a plain textarea. Typing saves after a short pause; every 2 s the panel looks for changes Claude made to the file and shows them. If the file changed while you have unsaved typing, a bar offers "Take theirs" or "Keep mine". "Tell Claude" pastes the file path and how to work on it into Claude's prompt.

| Prop        | Type         |
| ----------- | ------------ |
| `sessionId` | `string`     |
| `claudeId`  | `string`     |
| `onhide`    | `() => void` |

States: saved, saving, changed outside (conflict bar).
