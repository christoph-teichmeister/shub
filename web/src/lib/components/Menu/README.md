# Menu

Popup menu (`role="menu"`), used as the session menu. Arrow keys, Home/End move focus; Escape or a click outside closes it. Selecting an item calls `onselect(id)` then `onclose()`. Confirmation of destructive items is the caller's job (open a `Dialog`).

| Prop       | Type           | Notes                                                       |
| ---------- | -------------- | ----------------------------------------------------------- |
| `label`    | `string`       | aria-label                                                  |
| `items`    | `MenuItem[]`   | `id, label, hint, description, danger, disabled, separator` |
| `onselect` | `(id) => void` |                                                             |
| `onclose`  | `() => void`   |                                                             |
| `x`, `y`   | `number`       | Fixed position (context menu)                               |

States: plain items, hint, danger item with description, separator, disabled.
