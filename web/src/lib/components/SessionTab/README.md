# SessionTab

One session in the tab bar: status mark, name (`role="tab"`, only the selected one is in the Tab order; arrows move along the `TabBar`), first link as a chip, menu button (`⋯`) and close button, both shown on the selected tab and on hover. Double-click (or Alt R from the view) renames in place; Enter saves, Escape cancels. Right-click or `⋯` opens the session menu.

| Prop          | Type                       | Notes                                        |
| ------------- | -------------------------- | -------------------------------------------- |
| `session`     | `Session`                  |                                              |
| `selected`    | `boolean`                  |                                              |
| `closing`     | `boolean`                  | Fades, "Closing" badge                       |
| `renaming`    | `boolean` (bindable)       |                                              |
| `onselect`    | `() => void`               |                                              |
| `onrename`    | `(name: string) => void`   | Only called on a change                      |
| `onclose`     | `() => void`               | The view asks if working                     |
| `oncompact`   | `() => void`               | Chip from 160k tokens: sends `/compact`      |
| `onmenu`      | `(at: {x, y}) => void`     | Right-click or `⋯`                           |
| `ondragstart` | `(e: DragEvent) => void`   | Makes the tab draggable (not while renaming) |
| `ondrop`      | `(after: boolean) => void` | `after`: dropped on the right half           |

States: drop target (line left or right), closing (fades out, `Closing` badge, inert), selected (open like a folder tab, no line under it), unselected, hover, needs-you, working, your-turn, waiting (tooltip on the name), renaming, with link chip. Context fill: a 2px bar along the bottom edge (width = share of the window; colour by tokens: muted, yellow from 120k, danger from 160k) and the fill in the name's tooltip; from 160k a compact chip, disabled until it is your turn.
