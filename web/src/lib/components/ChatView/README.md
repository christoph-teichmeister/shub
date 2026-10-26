# ChatView

The phone's native view of a Claude session, instead of the live terminal: the tail of Claude's transcript (`GET /api/sessions/:id/messages`, parsed in `server/sessions/chat.ts`) as bubbles. No terminal is mounted, so this device opens no PTY and never resizes the shared tmux window.

- Your prompts as bubbles, Claude's replies as Markdown (`NotesPanel/Preview`, `lib/draft.ts` parser), tool calls as one-line cards (name, short summary, running / done / failed; tap to expand the result). Thinking, subagent lines and command wrappers are hidden.
- Fetches only the new lines (`?after=<byte offset>`, merged by id; a full load on the first call, `/clear` or a truncated file) when the server sends `session.messages` (after a prompt, a tool call or the end of a turn) and when `/clear` changes `claudeSessionId`. Follows the bottom until you scroll up.
- Native multiline `textarea`; Send pastes the text (newlines stay) and presses Enter, through `sessionPaste` and `sessionKeys`. Needs Control; a Prompts phone sees no input. The unsent draft is kept per session in `localStorage` (`shub.chatDraft.<id>`).
- `children` is rendered between the messages and the input (Phone puts the command chips and the permission question there).

| Prop       | Type      | Default |
| ---------- | --------- | ------- |
| `session`  | `Session` |         |
| `children` | `Snippet` |         |

Limits: the last 80 messages only, no pictures or attachments, tool results are cut at 2000 characters, a reply appears when Claude's turn step ends (not token by token).
