# SessionCard

One session as a status card, in the overview's strip of quiet (paused, not started) sessions (`#/overview`): status mark and text, time in that status, name, project chip, a line for what it does or waits for, context fill along the bottom edge. The card links to the session.

| Prop        | Type         | Notes                                                       |
| ----------- | ------------ | ----------------------------------------------------------- |
| `session`   | `Session`    |                                                             |
| `href`      | `string`     |                                                             |
| `project`   | `string`     | Name for the chip                                           |
| `accent`    | CSS colour   | Left edge, the project colour                               |
| `panes`     | `number`     | Panes rolled up into this card (chip `+N panes`)            |
| `onallow`   | `() => void` | With `ondeny`: Allow / Deny buttons while a permission asks |
| `ondeny`    | `() => void` |
| `onrestore` | `() => void` | Show button: brings a minimized session back                |     |

States: needs-you (orange frame), needs-you with a permission question (Allow / Deny), working, your-turn, waiting (line: what for), paused and starting (dimmed), with commands waiting (`▶ N commands`), with agents (line: the last tool call), context fill.
