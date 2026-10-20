# SessionRow

One session under its project in the sidebar: status mark, name, status text, a link to `#/p/<project>/<session>`. With `onmenu`, hover or focus swaps the status text for a menu button (`⋯`), and right-click opens the same session menu.

| Prop       | Type                   | Default |
| ---------- | ---------------------- | ------- |
| `session`  | `Session`              |         |
| `href`     | `string`               |         |
| `selected` | `boolean`              | `false` |
| `closing`  | `boolean`              | `false` |
| `onmenu`   | `(at: {x, y}) => void` |         |

States: closing (fades out, status reads `Closing`, inert), needs-you (tinted orange row), working, your-turn, waiting (tooltip: what for and the last background check), paused, exited, selected.
