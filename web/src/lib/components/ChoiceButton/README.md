# ChoiceButton

One option of a single choice, as a toggle `<button aria-pressed>`: theme cards, icon kind, symbols, colours, visibility. Group several in a container with a label (`role="group"` + `aria-label`).

| Prop       | Type                                       | Default  | Notes                                        |
| ---------- | ------------------------------------------ | -------- | -------------------------------------------- |
| `pressed`  | `boolean`                                  |          | The selected option                          |
| `shape`    | `'card' \| 'pill' \| 'square' \| 'swatch'` | `'pill'` | `square`/`swatch` need an `aria-label`       |
| `swatch`   | CSS colour                                 |          | Fill of a `swatch` (never the status orange) |
| `children` | snippet                                    |          | Content (not used by `swatch`)               |

States: each shape unpressed, pressed, hover, focus ring, disabled.
