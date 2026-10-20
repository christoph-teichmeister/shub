# StatusDot

The small status mark in front of a session name. Decorative (aria-hidden): always put the status text next to it.

| Prop     | Type            | Notes |
| -------- | --------------- | ----- |
| `status` | `SessionStatus` |       |

States: `new` (dashed muted ring, Claude is up but got no prompt yet), `needs-you` (solid orange dot, the only orange), `working` (cyan ring), `your-turn` (green check), `waiting` (muted clock, parked on purpose), `paused` (pause bars), `exited` (muted ring).
