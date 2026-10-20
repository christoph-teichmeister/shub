# SessionTab

One session in the tab bar: status mark, name (`role="tab"`, only the selected one is in the Tab order; arrows move along the `TabBar`), first link as a chip, close button. Double-click (or Alt R from the view) renames in place; Enter saves, Escape cancels. Right-click opens the session menu.

| Prop       | Type                      | Notes                    |
| ---------- | ------------------------- | ------------------------ |
| `session`  | `Session`                 |                          |
| `selected` | `boolean`                 |                          |
| `closing`  | `boolean`                 | Fades, "Closing" badge   |
| `renaming` | `boolean` (bindable)      |                          |
| `onselect` | `() => void`              |                          |
| `onrename` | `(name: string) => void`  | Only called on a change  |
| `onclose`  | `() => void`              | The view asks if working |
| `onmenu`   | `(e: MouseEvent) => void` | Context menu             |

States: closing (fades out, `Closing` badge, inert), selected (open like a folder tab, no line under it), unselected, hover, needs-you, working, your-turn, renaming, with link chip, prompt-skipping mode (`auto` / `bypass` badge in the danger colour, from `PROMPT_SKIPPING_MODES`).
