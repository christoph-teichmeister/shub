# SessionTab

One session in the tab bar: status mark, name (`role="tab"`), first link as a chip, close button. Double-click (or Alt R from the view) renames in place; Enter saves, Escape cancels. Right-click opens the session menu.

| Prop       | Type                      | Notes                    |
| ---------- | ------------------------- | ------------------------ |
| `session`  | `Session`                 |                          |
| `selected` | `boolean`                 |                          |
| `renaming` | `boolean` (bindable)      |                          |
| `onselect` | `() => void`              |                          |
| `onrename` | `(name: string) => void`  | Only called on a change  |
| `onclose`  | `() => void`              | The view asks if working |
| `onmenu`   | `(e: MouseEvent) => void` | Context menu             |

States: selected, unselected, needs-you, working, your-turn, renaming, with link chip.
