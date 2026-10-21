# WorktreeRow

A worktree a session created, nested under that session in the sidebar (under the project once the session closed). Shows a folder mark, the folder name, a speech-bubble mark when a conversation there can be resumed, and the worktree state (`working` while a Claude still writes there). A click starts Claude in the worktree, resuming that conversation if there is one. While a Claude runs there through shub, the view shows that session's row instead.

| Prop       | Type            | Default                     |
| ---------- | --------------- | --------------------------- |
| `worktree` | `ChildWorktree` |                             |
| `onopen`   | `() => void`    | Without it the row is inert |

States: dormant (muted), resumable (speech bubble), busy (status `working`, not clickable), merged (faded further).
