# SessionRow

One session under its project in the sidebar: status mark, name, status text. A link to `#/p/<project>/<session>`.

| Prop       | Type      | Default |
| ---------- | --------- | ------- |
| `session`  | `Session` |         |
| `href`     | `string`  |         |
| `selected` | `boolean` | `false` |

States: needs-you (tinted orange row), working, your-turn, paused, exited, selected.
