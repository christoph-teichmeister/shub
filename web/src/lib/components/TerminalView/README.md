# TerminalView

xterm.js bound to `/api/terminals/:id` (raw PTY bytes both ways; `\u0000{json}` control frames for resize). Uses only the official fit and web-links addons.

- Theme from the `term-*` tokens plus `selection` (each follows a UI token until the theme sets it, see `TERMINAL_DEFAULTS`), re-applied on theme change.
- Font (plus fallback font), size, line height, letter spacing, weight, cursor style/blink and scrollback from Settings > Terminal (`terminalSettings()`: defaults, `config.terminal`, then this browser's own overlay in `localStorage` `shub.terminal.device`), applied live with a refit. `compact` uses one px less.
- Cursor in the project accent.
- Select to copy (`onSelectionChange` + `navigator.clipboard.writeText`).
- Ctrl+V and the `paste` event: text goes to `POST /api/sessions/:id/paste` as `text/plain`, images and other files as their blob; drop works the same. Ctrl+C stays interrupt.
- Reconnects every 2 s after the socket drops; resets the screen so tmux can repaint.

| Prop        | Type       | Default      |
| ----------- | ---------- | ------------ |
| `sessionId` | `string`   |              |
| `accent`    | CSS colour | brand pink   |
| `focused`   | `boolean`  | `false`      |
| `label`     | `string`   | `'Terminal'` |
| `compact`   | `boolean`  | `false`      |

States: connected, reconnecting (screen kept until the next attach).
